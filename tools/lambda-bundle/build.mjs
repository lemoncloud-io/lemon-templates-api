import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import webpack from 'webpack';
import TerserPlugin from 'terser-webpack-plugin';
import JavaScriptObfuscator from 'javascript-obfuscator';
import remapping from '@jridgewell/remapping';
import ts from 'typescript';

export const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROFILES = ['baseline', 'webpack-minified', 'obfuscated'];
export const DEFAULT_OUTPUT = path.resolve(LAB_DIR, '../../.artifacts/bundle-lab');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);
const sourceFile = path.join(LAB_DIR, 'fixture/handler.ts');

export const OBFUSCATOR_OPTIONS = Object.freeze({
    target: 'node', compact: true, seed: 20261030,
    optionsPreset: 'default', advertisement: false, log: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false, renameProperties: false,
    controlFlowFlattening: false, deadCodeInjection: false,
    debugProtection: false, debugProtectionInterval: 0,
    selfDefending: false, disableConsoleOutput: false,
    numbersToExpressions: false, simplify: false,
    splitStrings: false, stringArray: false,
    transformObjectKeys: false, unicodeEscapeSequence: false,
    sourceMap: true, sourceMapMode: 'separate',
    sourceMapSourcesMode: 'sources-content',
    inputFileName: 'handler.cjs', sourceMapFileName: 'handler.cjs.map',
});

export async function versions() {
    const pkg = JSON.parse(await readFile(path.join(LAB_DIR, 'package.json'), 'utf8'));
    return Object.fromEntries(Object.keys(pkg.devDependencies).map(name => [name, require(`${name}/package.json`).version]));
}

function stripMapURL(code) {
    return code.replace(/^\/\/[#@] sourceMappingURL=.*(?:\r?\n|$)/gm, '');
}

async function webpackMinify(outputPath) {
    const compiler = webpack({
        mode: 'production', target: 'node24', context: LAB_DIR,
        entry: './fixture/handler.ts', cache: false,
        devtool: 'hidden-source-map',
        externalsPresets: { node: true },
        output: {
            path: outputPath, filename: 'handler.cjs',
            library: { type: 'commonjs2' },
            devtoolModuleFilenameTemplate: info => `lab:///${info.resourcePath.replace(/^\.\//, '')}`,
        },
        module: { rules: [{ test: /\.ts$/, use: path.join(LAB_DIR, 'ts-loader.cjs') }] },
        optimization: {
            minimize: true,
            minimizer: [new TerserPlugin({
                parallel: false, extractComments: false,
                terserOptions: {
                    ecma: 2022,
                    // Keep function boundaries for useful stack frames. Property names are API.
                    compress: { defaults: true, inline: false, reduce_funcs: false, passes: 1 },
                    mangle: { properties: false },
                    format: { comments: false },
                },
            })],
        },
    });
    try {
        await new Promise((resolve, reject) => compiler.run((error, stats) => {
            if (error) return reject(error);
            if (stats.hasErrors() || stats.hasWarnings()) return reject(new Error(stats.toString({ all: false, errors: true, warnings: true })));
            resolve();
        }));
    } finally {
        await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    }
    return {
        code: await readFile(path.join(outputPath, 'handler.cjs'), 'utf8'),
        map: JSON.parse(await readFile(path.join(outputPath, 'handler.cjs.map'), 'utf8')),
    };
}

async function saveProfile({ root, profile, code, map, buildId, source, tools, stages }) {
    const profileDir = path.join(root, profile);
    await mkdir(path.join(profileDir, 'runtime'), { recursive: true });
    await mkdir(path.join(profileDir, 'debug'), { recursive: true });
    const runtimeFile = path.join(profileDir, 'runtime/handler.cjs');
    code = stripMapURL(code);
    if (/sourceMappingURL|sourcesContent/.test(code)) throw new Error('Runtime source-map data detected');
    const codeSha256 = sha256(code);
    map.file = 'handler.cjs';
    map.x_lambda_bundle = { buildId, profile, codeSha256 };
    const mapText = `${JSON.stringify(map)}\n`;
    const manifest = {
        schemaVersion: 1, buildId, profile,
        handler: { file: 'handler.cjs', export: 'lambda' },
        runtimeFile: 'runtime/handler.cjs', mapFile: 'debug/handler.cjs.map',
        codeSha256, mapSha256: sha256(mapText), sourceSha256: sha256(source),
        source: {
            file: 'fixture/handler.ts',
            throwLine: source.split('\n').findIndex(line => line.includes('ORIGINAL_THROW_MARKER')) + 1,
        },
        tools, bytes: { code: Buffer.byteLength(code), map: Buffer.byteLength(mapText) },
        stagesMs: stages,
    };
    await writeFile(runtimeFile, code);
    await writeFile(path.join(profileDir, manifest.mapFile), mapText);
    await writeFile(path.join(profileDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { profileDir, runtimeDir: path.dirname(runtimeFile), manifest };
}

/** Every call creates a fresh output directory; never overwrites a prior measurement. */
export async function buildAll({ outputRoot = DEFAULT_OUTPUT } = {}) {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Bundle lab requires Node 24');
    await mkdir(outputRoot, { recursive: true });
    const root = await realpath(await mkdtemp(path.join(path.resolve(outputRoot), 'build-')));
    const buildId = randomUUID();
    const source = await readFile(sourceFile, 'utf8');
    const tools = await versions();
    const profiles = {};
    let started = performance.now();
    const baseline = ts.transpileModule(source, {
        fileName: 'fixture/handler.ts',
        compilerOptions: {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
            sourceMap: true, inlineSources: true, removeComments: true,
        },
    });
    const baselineMs = performance.now() - started;
    const baselineMap = JSON.parse(baseline.sourceMapText);
    baselineMap.sources = ['lab:///fixture/handler.ts'];
    profiles.baseline = await saveProfile({ root, profile: 'baseline', code: baseline.outputText,
        map: baselineMap, buildId, source, tools, stages: { typescript: baselineMs, total: baselineMs } });
    // Staging maps are never placed inside the runtime directory.
    const staging = path.join(root, '.staging');
    await mkdir(staging);
    try {
        started = performance.now();
        const bundled = await webpackMinify(staging);
        const webpackMs = performance.now() - started;
        profiles['webpack-minified'] = await saveProfile({ root, profile: 'webpack-minified', ...bundled,
            buildId, source, tools, stages: { typescriptWebpackTerser: webpackMs, total: webpackMs } });
        started = performance.now();
        const obfuscated = JavaScriptObfuscator.obfuscate(bundled.code, OBFUSCATOR_OPTIONS);
        const obfuscatorMs = performance.now() - started;
        started = performance.now();
        // Newest transformation first: obfuscated JS -> minified JS -> original TS.
        const composed = remapping([JSON.parse(obfuscated.getSourceMap()), bundled.map], () => null);
        const composeMs = performance.now() - started;
        profiles.obfuscated = await saveProfile({ root, profile: 'obfuscated', code: obfuscated.getObfuscatedCode(),
            map: JSON.parse(JSON.stringify(composed)), buildId, source, tools,
            stages: { typescriptWebpackTerser: webpackMs, obfuscator: obfuscatorMs, compose: composeMs,
                total: webpackMs + obfuscatorMs + composeMs } });
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
    return { root, buildId, profiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length > 2) throw new Error('Usage: npm run build (outputs under .artifacts/bundle-lab)');
    const result = await buildAll();
    console.log(JSON.stringify({ root: result.root, buildId: result.buildId, profiles: PROFILES }, null, 2));
}
