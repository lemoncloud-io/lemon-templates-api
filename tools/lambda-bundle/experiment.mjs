import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildAll, PROFILES } from './build.mjs';
import { symbolicateStack } from './symbolicate.mjs';
import { runLocal } from '../../bin/lib/local-runner.mjs';

export function summarize(values) {
    const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!finite.length) return { n: 0, min: null, median: null, mean: null, max: null };
    const middle = Math.floor(finite.length / 2);
    return { n: finite.length, min: finite[0],
        median: finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2,
        mean: finite.reduce((total, value) => total + value, 0) / finite.length,
        max: finite.at(-1) };
}

function measurement(result) {
    return {
        initMs: summarize(result.runs.filter(run => run.cold).map(run => run.timings.initMs)),
        invokeMs: summarize(result.runs.map(run => run.timings.invokeMs)),
        steadyInvokeMs: summarize(result.runs.filter(run => !run.cold).map(run => run.timings.invokeMs)),
        totalMs: summarize(result.runs.map(run => run.timings.totalMs)),
        samples: result.runs.map(run => ({ cold: run.cold, status: run.status, ...run.timings })),
    };
}

/** Synthetic fixture only. Measured timings describe this host and runner, never AWS Lambda. */
export async function experiment({ runs = 10, buildRuns = 3, outputRoot } = {}) {
    for (const [name, value] of Object.entries({ runs, buildRuns })) {
        if (!Number.isSafeInteger(value) || value < 2 || value > 100) throw new Error(`${name} must be an integer from 2 to 100`);
    }
    const builds = [];
    for (let index = 0; index < buildRuns; index++) builds.push(await buildAll({ outputRoot }));
    const build = builds.at(-1);
    const report = {
        schemaVersion: 1, experiment: 'lambda-bundle-synthetic-fixture',
        createdAt: new Date().toISOString(), buildId: build.buildId,
        host: { node: process.version, platform: process.platform, architecture: process.arch, osRelease: os.release() },
        runs, buildRuns, tools: build.profiles.baseline.manifest.tools,
        boundaries: {
            build: 'Baseline measures in-memory TypeScript transpilation. The webpack stage includes compiler setup, TypeScript/webpack/Terser, staging file emit/read and compiler close. Tool imports and final runtime/debug/manifest writes are excluded. Sequential builds in one process; webpack filesystem cache disabled, process/module caches retained. Obfuscated total adds the shared measured webpack stage, obfuscator transformation and separate map composition.',
            runtime: 'WP1 Node child-process runner. Cold uses fresh child/module; warm reuses one child/module. See docs/lambda-local.md for init/invoke/total boundaries. Warm steady excludes first invocation.',
            comparison: 'Three profiles use one authored fixture; baseline is TS-to-CJS, webpack-minified adds bundling/Terser, obfuscated adds conservative identifier obfuscation. Fixed profile order, no CPU isolation; tiny timings are noisy.',
            limits: 'No AWS, Docker, IAM, VPC, Linux ABI, Lambda CPU/memory allocation or deployed cold-start claim.',
        },
        profiles: {},
    };
    for (const profile of PROFILES) {
        const { runtimeDir, profileDir, manifest } = build.profiles[profile];
        const options = { root: runtimeDir, handler: { file: 'handler.cjs', export: 'lambda' },
            event: { action: 'calculate', values: [2, 3, 5] }, runs, timeoutMs: 3000, env: {}, maxLogBytes: 65536 };
        const cold = await runLocal({ ...options, mode: 'cold' });
        const warm = await runLocal({ ...options, mode: 'warm' });
        report.boundaries.runner = { init: cold.measurements.init, invoke: cold.measurements.invoke, total: cold.measurements.total };
        for (const [mode, result] of Object.entries({ cold, warm })) {
            assert.equal(result.runs.length, runs, `${profile}/${mode} run count`);
            result.runs.forEach((run, index) => {
                assert.equal(run.status, 'success', `${profile}/${mode}: ${JSON.stringify(run.error)}`);
                assert.equal(run.result.total, 38);
                assert.equal(run.result.invocationCount, mode === 'cold' ? 1 : index + 1);
            });
        }
        const thrown = await runLocal({ ...options, mode: 'cold', runs: 1, event: { action: 'throw' } });
        assert.equal(thrown.runs[0].status, 'error', `${profile} expected fixture throw`);
        const rawStack = thrown.runs[0].error.stack;
        const restored = await symbolicateStack({ profileDir, stack: rawStack, expectedBuildId: build.buildId });
        assert.equal(restored.frames[0]?.original.file, 'lab:///fixture/handler.ts');
        assert.equal(restored.frames[0]?.original.line, manifest.source.throwLine);
        await writeFile(path.join(profileDir, 'debug/raw-stack.txt'), rawStack);
        await writeFile(path.join(profileDir, 'debug/restored-stack.json'), `${JSON.stringify(restored, null, 2)}\n`);
        report.profiles[profile] = {
            artifact: path.relative(build.root, profileDir), codeSha256: manifest.codeSha256,
            bytes: { ...manifest.bytes, gzipCode: gzipSync(await readFile(path.join(runtimeDir, 'handler.cjs'))).byteLength },
            buildMs: summarize(builds.map(item => item.profiles[profile].manifest.stagesMs.total)),
            buildSamples: builds.map(item => item.profiles[profile].manifest.stagesMs),
            cold: measurement(cold), warm: measurement(warm),
            restoration: { expected: manifest.source, actual: restored.frames[0].original, passed: true },
        };
    }
    const reportFile = path.join(build.root, 'report.json');
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    return { reportFile, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const options = {};
    const args = process.argv.slice(2);
    while (args.length) {
        const flag = args.shift(), value = args.shift();
        if (!['--runs', '--build-runs'].includes(flag) || value === undefined) throw new Error('Usage: npm run experiment -- [--runs N] [--build-runs N]');
        options[flag === '--runs' ? 'runs' : 'buildRuns'] = Number(value);
    }
    const { reportFile, report } = await experiment(options);
    console.log(JSON.stringify({ reportFile, ...report }, null, 2));
}
