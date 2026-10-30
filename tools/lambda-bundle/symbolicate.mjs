import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Read trusted, private debug artifacts. Hash binding detects mismatches, not tampering by a signer. */
export async function symbolicateStack({ profileDir, stack, expectedBuildId, generatedFile, expectedCodeSha256 }) {
    if (!expectedBuildId) throw new Error('expectedBuildId is required');
    if (typeof stack !== 'string') throw new Error('stack must be a string');
    const directory = path.resolve(profileDir);
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.buildId !== expectedBuildId) throw new Error('Build ID mismatch');
    if (manifest.runtimeFile !== 'runtime/handler.cjs' || manifest.mapFile !== 'debug/handler.cjs.map') throw new Error('Unexpected artifact paths');
    const codeFile = await realpath(path.join(directory, manifest.runtimeFile));
    const frameFile = generatedFile ?? codeFile;
    if (!path.isAbsolute(frameFile)) throw new Error('generatedFile must be an absolute runtime path');
    if (frameFile !== codeFile && !expectedCodeSha256) throw new Error('expectedCodeSha256 is required for a relocated stack');
    if (expectedCodeSha256 !== undefined && expectedCodeSha256 !== manifest.codeSha256) throw new Error('Expected code SHA-256 mismatch');
    const [code, mapText] = await Promise.all([
        readFile(codeFile), readFile(path.join(directory, manifest.mapFile), 'utf8'),
    ]);
    if (sha256(code) !== manifest.codeSha256) throw new Error('Code SHA-256 mismatch');
    if (sha256(mapText) !== manifest.mapSha256) throw new Error('Map SHA-256 mismatch');
    const map = JSON.parse(mapText);
    const binding = map.x_lambda_bundle;
    if (binding?.buildId !== expectedBuildId || binding?.codeSha256 !== manifest.codeSha256 || binding?.profile !== manifest.profile) {
        throw new Error('Map/build/code binding mismatch');
    }
    const consumer = new SourceMap(map);
    const frames = [];
    const expression = new RegExp(`(^|[\\s(])(?:file:\\/\\/)?${escapeRegex(frameFile)}:(\\d+):(\\d+)`, 'gm');
    const restoredStack = stack.replace(expression, (location, prefix, lineText, columnText) => {
        const line = Number(lineText), column = Number(columnText);
        // V8 stack coordinates are 1-based; SourceMap.findEntry uses 0-based offsets.
        const entry = consumer.findEntry(line - 1, column - 1);
        if (!entry.originalSource || entry.originalLine === undefined) return location;
        const original = { file: entry.originalSource, line: entry.originalLine + 1,
            column: entry.originalColumn + 1, name: entry.name ?? null };
        frames.push({ generated: { file: 'handler.cjs', line, column }, original });
        return `${prefix}${original.file}:${original.line}:${original.column}`;
    });
    return { status: frames.length ? 'mapped' : 'unmatched', buildId: expectedBuildId, profile: manifest.profile, codeSha256: manifest.codeSha256, frames, stack: restoredStack };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [profileDir, expectedBuildId, stackFile, ...extra] = process.argv.slice(2);
    const options = {};
    while (extra.length) {
        const flag = extra.shift(), value = extra.shift();
        const key = { '--generated-file': 'generatedFile', '--code-sha256': 'expectedCodeSha256' }[flag];
        if (!key || !value || options[key] !== undefined) throw new Error('Invalid symbolication option');
        options[key] = value;
    }
    if (!profileDir || !expectedBuildId || !stackFile) throw new Error('Usage: npm run symbolicate -- <profile-dir> <build-id> <raw-stack.txt> [--generated-file <absolute-path> --code-sha256 <recorded-code-sha>]');
    const result = await symbolicateStack({ profileDir, expectedBuildId, stack: await readFile(stackFile, 'utf8'), ...options });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'unmatched') process.exitCode = 1;
}
