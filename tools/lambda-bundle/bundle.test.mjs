import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { buildAll, PROFILES } from './build.mjs';
import { symbolicateStack } from './symbolicate.mjs';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
let temp, build;
before(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'lambda-bundle-test-'));
    build = await buildAll({ outputRoot: temp });
});
after(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

async function rawError(runtimeDir) {
    const { stdout } = await execute(process.execPath, ['--enable-source-maps', '-e', `
        const { lambda } = require(process.argv[1]);
        lambda({action:'throw'}).then(() => process.exit(2), error => process.stdout.write(JSON.stringify(error.stack)));
    `, path.join(runtimeDir, 'handler.cjs')], { timeout: 5000, env: {} });
    return JSON.parse(stdout);
}

for (const profile of PROFILES) {
    test(`${profile}: CJS lambda contract, results and warm state survive transforms`, async () => {
        const { runtimeDir } = build.profiles[profile];
        const filename = path.join(runtimeDir, 'handler.cjs');
        delete require.cache[require.resolve(filename)];
        const { lambda } = require(filename);
        assert.equal(typeof lambda, 'function');
        const first = await lambda({ values: [2, 3, 5] }, { awsRequestId: 'first' });
        const second = await lambda({ values: [-2, 4] }, { awsRequestId: 'second' });
        assert.equal(first.total, 38);
        assert.equal(first.label, 'bundle-lab');
        assert.equal(first.invocationCount, 1);
        assert.equal(first.requestId, 'first');
        assert.equal(second.total, 20);
        assert.equal(second.invocationCount, 2);
        assert.equal(second.requestId, 'second');
        assert.match(first.checksum, /^[0-9a-f]{64}$/);
    });
    test(`${profile}: raw generated stack restores the exact TypeScript throw line`, async () => {
        const { runtimeDir, profileDir, manifest } = build.profiles[profile];
        const stack = await rawError(runtimeDir);
        assert.match(stack, /BUNDLE_LAB_EXPECTED_ERROR/);
        assert.ok(stack.includes(path.join(runtimeDir, 'handler.cjs')));
        assert.ok(!stack.includes('fixture/handler.ts'), 'hidden maps must not be auto-loaded');
        const restored = await symbolicateStack({ profileDir, stack, expectedBuildId: build.buildId });
        assert.ok(restored.frames.length > 0);
        assert.equal(restored.frames[0].original.file, 'lab:///fixture/handler.ts');
        assert.equal(restored.frames[0].original.line, manifest.source.throwLine);
        assert.match(restored.stack, new RegExp(`fixture/handler\\.ts:${manifest.source.throwLine}:`));
    });
    test(`${profile}: runtime contains only JS; private map retains authored TS`, async () => {
        const { runtimeDir, profileDir, manifest } = build.profiles[profile];
        assert.deepEqual(await readdir(runtimeDir), ['handler.cjs']);
        const code = await readFile(path.join(runtimeDir, 'handler.cjs'), 'utf8');
        assert.doesNotMatch(code, /sourceMappingURL|sourcesContent|interface LabEvent|ORIGINAL_THROW_MARKER/);
        const map = JSON.parse(await readFile(path.join(profileDir, manifest.mapFile), 'utf8'));
        assert.ok(map.sourcesContent.some(source => source?.includes('ORIGINAL_THROW_MARKER')));
    });
}

test('mismatched build ID, changed runtime code and wrong map are rejected', async () => {
    const { profileDir, runtimeDir, manifest } = build.profiles.obfuscated;
    const stack = await rawError(runtimeDir);
    const args = { profileDir, stack, expectedBuildId: build.buildId };
    await assert.rejects(symbolicateStack({ ...args, expectedBuildId: 'different-build' }), /Build ID mismatch/);
    const codePath = path.join(runtimeDir, 'handler.cjs');
    const originalCode = await readFile(codePath);
    try {
        await writeFile(codePath, Buffer.concat([originalCode, Buffer.from('\n// altered') ]));
        await assert.rejects(symbolicateStack(args), /Code SHA-256 mismatch/);
    } finally { await writeFile(codePath, originalCode); }
    const mapPath = path.join(profileDir, manifest.mapFile);
    const originalMap = await readFile(mapPath);
    try {
        await writeFile(mapPath, await readFile(path.join(build.profiles.baseline.profileDir, manifest.mapFile)));
        await assert.rejects(symbolicateStack(args), /Map SHA-256 mismatch/);
    } finally { await writeFile(mapPath, originalMap); }
});

test('same source, pinned tools and obfuscator seed reproduce identical runtime bytes', async () => {
    const second = await buildAll({ outputRoot: temp });
    assert.notEqual(second.buildId, build.buildId);
    for (const profile of PROFILES) {
        assert.equal(second.profiles[profile].manifest.codeSha256, build.profiles[profile].manifest.codeSha256);
    }
});

test('relocated runtime frames require the recorded code SHA and restore exact source', async () => {
    const { profileDir, runtimeDir, manifest } = build.profiles.obfuscated;
    const generatedFile = '/var/task/handler.cjs';
    const stack = (await rawError(runtimeDir)).replaceAll(path.join(runtimeDir, 'handler.cjs'), generatedFile);
    const options = { profileDir, stack, expectedBuildId: build.buildId, generatedFile };
    await assert.rejects(symbolicateStack(options), /expectedCodeSha256 is required/);
    await assert.rejects(symbolicateStack({ ...options, expectedCodeSha256: build.profiles.baseline.manifest.codeSha256 }), /Expected code SHA-256 mismatch/);
    const restored = await symbolicateStack({ ...options, expectedCodeSha256: manifest.codeSha256 });
    assert.equal(restored.status, 'mapped');
    assert.equal(restored.frames[0].original.file, 'lab:///fixture/handler.ts');
    assert.equal(restored.frames[0].original.line, manifest.source.throwLine);
});

test('unrelated same-basename or path-suffix frames stay unmatched, including CLI exit', async () => {
    const { profileDir, runtimeDir } = build.profiles.obfuscated;
    const unrelated = `Error: unrelated\n    at other (/unrelated/handler.cjs:1:10)\n    at other (/prefix${path.join(runtimeDir, 'handler.cjs')}:1:10)`;
    const result = await symbolicateStack({ profileDir, stack: unrelated, expectedBuildId: build.buildId });
    assert.equal(result.status, 'unmatched');
    assert.deepEqual(result.frames, []);
    assert.equal(result.stack, unrelated);
    const stackFile = path.join(temp, 'unmatched-stack.txt');
    await writeFile(stackFile, unrelated);
    await assert.rejects(execute(process.execPath, [path.join(import.meta.dirname, 'symbolicate.mjs'), profileDir, build.buildId, stackFile]), error => {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stdout).status, 'unmatched');
        return true;
    });
});
