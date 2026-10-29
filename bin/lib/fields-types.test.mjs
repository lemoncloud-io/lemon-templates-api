/**
 * `bin/lib/fields-types.test.mjs`
 * - offline tests for `fields-types.mjs` on the dummy models of `fixtures/fields-types/` (no AWS, no OpenSearch).
 * - run: `npm run lambda:test`
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    run,
    parseOptions,
    collectModels,
    normalizeType,
    flattenFields,
    findConflicts,
    mergeReports,
    formatSummary,
    severityOf,
    checkRepo,
    exitCode,
    ArgError,
} from './fields-types.mjs';

// the CLI entry.
const SCRIPT = fileURLToPath(new URL('../fields-types.mjs', import.meta.url));

// the fixture repo (dummy models only).
const FIXTURE = fileURLToPath(new URL('fixtures/fields-types/', import.meta.url));

// the known conflicts of the fixture at deep 2 (name -> severity).
const KNOWN = {
    error: 'hard',
    hidden: 'hard',
    owner$: 'hard',
    count: 'order',
    kind: 'order',
    'owner$.id': 'order',
    tags: 'order',
};

// run the CLI with `args`; returns `{ status, stdout, stderr }`.
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

// a one-model report as `--json` writes it.
const fakeReport = (repo, model, fields) => ({
    repo,
    deep: 2,
    rule: 'R',
    files: 1,
    fieldEntries: 1,
    modelsFound: 1,
    fields: fields.length,
    models: [{ name: model, file: 'src/model.ts', line: 1, rules: ['R'], fields }],
    conflicts: [],
    any: [],
    mixed: [],
    other: [],
    unresolved: [],
});

describe('fields-types: collect and normalize', () => {
    let collected;
    let report;
    // one TS program for this block (building it takes about a second).
    before(() => {
        collected = collectModels({ root: FIXTURE });
        report = checkRepo({ root: FIXTURE, deep: 2 });
    });

    test('rule R takes the 5 `$FIELD` models; RH adds the CoreModel-shaped view', () => {
        assert.deepEqual(collected.models.map(m => m.name).sort(), ['AModel', 'BModel', 'CModel', 'DModel', 'EModel']);
        assert.equal(collected.fieldEntries, 5);
        assert.deepEqual(collected.unresolved, []);
        const rh = collectModels({ root: FIXTURE, models: 'RH' });
        assert.deepEqual(rh.models.map(m => m.name).sort(), [
            'AModel',
            'BModel',
            'CModel',
            'DModel',
            'EModel',
            'EView',
        ]);
    });

    test('finds all 7 known conflicts: hard 3, order 4', () => {
        const got = Object.fromEntries(report.conflicts.map(c => [c.name, c.severity]));
        assert.deepEqual(got, KNOWN);
        assert.equal(report.conflicts.filter(c => c.severity === 'hard').length, 3);
        assert.equal(report.conflicts.filter(c => c.severity === 'order').length, 4);
        // hard first, then by name.
        assert.deepEqual(
            report.conflicts.map(c => c.name),
            ['error', 'hidden', 'owner$', 'count', 'kind', 'owner$.id', 'tags'],
        );
    });

    test('a field of CoreModel (`error?: string`) conflicts with a model field (`error: object`)', () => {
        const c = report.conflicts.find(x => x.name === 'error');
        const core = c.decls.filter(d => d.type === 'string');
        assert.ok(core.length >= 4);
        assert.ok(core.every(d => d.file === 'lemon-model:core-storage.d.ts'));
        assert.deepEqual(
            c.decls.filter(d => d.type === 'object').map(d => [d.model, d.file]),
            [['CModel', 'src/model.ts']],
        );
    });

    test('normalization: nullish dropped, literal unions, arrays, Date, index signature', () => {
        const fields = Object.fromEntries(
            collected.models.map(m => [m.name, Object.fromEntries(flattenFields(m, 2).map(f => [f.name, f.type]))]),
        );
        // `number | null` -> number.
        assert.equal(fields.EModel.size, 'number');
        // `'x' | 'y' | null` -> string; `1 | 2` -> number; `0 | 1` (BoolFlag) -> number.
        assert.equal(fields.CModel.kind, 'string');
        assert.equal(fields.DModel.kind, 'number');
        assert.equal(fields.AModel.hidden, 'number');
        // `string[]` -> string; `number[]` -> number.
        assert.equal(fields.AModel.tags, 'string');
        assert.equal(fields.BModel.tags, 'number');
        // `Date` -> date (not object, not flattened).
        assert.equal(fields.AModel.at, 'date');
        assert.ok(!Object.keys(fields.AModel).some(k => k.startsWith('at.')));
        // index signature -> `labels.*` dynamic, not in any list or count.
        assert.equal(fields.EModel.labels, 'object');
        assert.equal(fields.EModel['labels.*'], 'dynamic');
        assert.ok(!report.any.some(d => d.name.startsWith('labels')));
        // `string | number` -> mixed; `any` -> any; `meta?: string | any` -> any.
        assert.equal(fields.EModel.either, 'mixed');
        assert.equal(fields.EModel.loose, 'any');
        assert.equal(fields.AModel.meta, 'any');
        assert.deepEqual(
            report.mixed.map(d => [d.name, d.model]),
            [['either', 'EModel']],
        );
        // stored names only: no `_id`, no `$`.
        assert.ok(!('_id' in fields.AModel) && !('$' in fields.AModel));
    });

    test('normalizeType reads a type through the checker', () => {
        const a = collected.models.find(m => m.name === 'AModel');
        const kind = name =>
            normalizeType(collected.checker, collected.checker.getTypeOfSymbol(a.type.getProperty(name)));
        assert.equal(kind('count'), 'number');
        assert.equal(kind('owner$'), 'object');
        assert.equal(kind('at'), 'date');
    });

    test('--deep 0 checks the top level only', () => {
        const top = checkRepo({ root: FIXTURE, deep: 0 });
        assert.ok(!top.conflicts.some(c => c.name.includes('.')));
        assert.equal(top.conflicts.length, 6);
    });
});

describe('fields-types: severity, merge, format', () => {
    test('severityOf: object vs scalar and boolean vs number are hard; the rest is order', () => {
        assert.equal(severityOf('object', 'string'), 'hard');
        assert.equal(severityOf('number', 'object'), 'hard');
        assert.equal(severityOf('boolean', 'number'), 'hard');
        assert.equal(severityOf('date', 'boolean'), 'hard');
        assert.equal(severityOf('string', 'number'), 'order');
        assert.equal(severityOf('boolean', 'string'), 'order');
        assert.equal(severityOf('date', 'string'), 'order');
        assert.equal(severityOf('date', 'number'), 'order');
    });

    test('findConflicts ignores any, mixed, and dynamic', () => {
        const r = findConflicts([
            { name: 'X', fields: [{ name: 'a', type: 'any', file: 'x.ts', line: 1 }] },
            { name: 'Y', fields: [{ name: 'a', type: 'string', file: 'y.ts', line: 1 }] },
            { name: 'Z', fields: [{ name: 'a', type: 'mixed', file: 'z.ts', line: 1 }] },
            { name: 'W', fields: [{ name: 'b.*', type: 'dynamic', file: 'w.ts', line: 1 }] },
        ]);
        assert.deepEqual(r.conflicts, []);
        assert.equal(r.any.length, 1);
        assert.equal(r.mixed.length, 1);
    });

    test('mergeReports: one name with two types in two repos is a conflict', () => {
        const a = fakeReport('one-api', 'AModel', [{ name: 'score', type: 'number', file: 'src/a.ts', line: 3 }]);
        const b = fakeReport('two-api', 'BModel', [{ name: 'score', type: 'string', file: 'src/b.ts', line: 7 }]);
        // each repo alone is clean.
        assert.equal(findConflicts(a.models).conflicts.length, 0);
        const m = mergeReports([a, b]);
        assert.equal(m.repo, 'one-api+two-api');
        assert.equal(m.conflicts.length, 1);
        assert.equal(m.conflicts[0].name, 'score');
        assert.equal(m.conflicts[0].severity, 'order');
        assert.deepEqual(
            m.conflicts[0].decls.map(d => [d.repo, d.model, d.type]),
            [
                ['one-api', 'AModel', 'number'],
                ['two-api', 'BModel', 'string'],
            ],
        );
        // order only: passes --fail-on hard, fails --fail-on order.
        assert.equal(exitCode(m, 'hard'), 0);
        assert.equal(exitCode(m, 'order'), 1);
        assert.match(formatSummary(m), /- order score: number\[one-api:AModel\(src\/a\.ts:3\)\] vs string\[two-api:/);
    });

    test('formatSummary: one summary line, then one line per conflict', () => {
        const report = checkRepo({ root: FIXTURE, deep: 2 });
        const lines = formatSummary(report).split('\n');
        assert.match(
            lines[0],
            /^fields-types repo=fields-types models=5 fields=\d+ conflicts=7 \(hard=3 order=4\) any=\d+ mixed=1 unresolved=0$/,
        );
        assert.equal(lines.length, 8);
        assert.match(
            lines[2],
            /^ {2}- hard hidden: number\[AModel\(src\/model\.ts:\d+\)\] vs boolean\[BModel\(src\/model\.ts:\d+\)\]$/,
        );
        // more than 3 models of one type: `+<n>`.
        assert.match(lines[1], /^ {2}- hard error: string\[[^\]]*, \+\d+\] vs object\[CModel\(src\/model\.ts:\d+\)\]$/);
        assert.equal(exitCode(report, 'hard'), 1);
        assert.equal(exitCode(report, 'none'), 0);
    });
});

describe('fields-types: arguments and CLI', () => {
    test('parseOptions: defaults, repeats, and bad values', () => {
        const o = parseOptions([]);
        assert.equal(o.deep, 2);
        assert.equal(o.models, 'R');
        assert.equal(o.failOn, 'hard');
        assert.deepEqual(o.with, []);
        assert.deepEqual(parseOptions(['--with', 'a.json', '--with=b.json']).with.length, 2);
        assert.throws(() => parseOptions(['--deep', 'x']), ArgError);
        assert.throws(() => parseOptions(['--deep', '11']), ArgError);
        assert.throws(() => parseOptions(['--models', 'H']), ArgError);
        assert.throws(() => parseOptions(['--fail-on', 'soft']), ArgError);
        assert.throws(() => parseOptions(['--foo']), /unknown option --foo/);
        assert.throws(() => parseOptions(['extra']), /unknown argument extra/);
        assert.throws(() => parseOptions(['--root']), /--root needs a value/);
        assert.deepEqual(parseOptions(['--foo', '--help']), { help: true });
    });

    test('run: --help prints the usage and exits 0', () => {
        const out = [];
        assert.equal(run(['--help'], { log: s => out.push(s) }), 0);
        assert.match(out[0], /usage: node bin\/fields-types\.mjs/);
    });

    test('exit 1: hard conflicts with the default --fail-on hard', () => {
        const r = cli('--root', FIXTURE);
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stdout, /^fields-types repo=fields-types models=5 .* conflicts=7 \(hard=3 order=4\)/);
    });

    test('exit 0 with --fail-on none, exit 1 with --fail-on order; --models RH', () => {
        assert.equal(cli('--root', FIXTURE, '--fail-on', 'none').status, 0);
        assert.equal(cli('--root', FIXTURE, '--fail-on', 'order').status, 1);
        // `--models RH` adds one order conflict (`size`); still 3 hard.
        const rh = cli('--root', FIXTURE, '--models', 'RH', '--fail-on', 'none');
        assert.equal(rh.status, 0);
        assert.match(rh.stdout, /models=6 .* conflicts=8 \(hard=3 order=5\)/);
        assert.match(rh.stdout, /- order size: number\[EModel\(src\/model\.ts:\d+\)\] vs string\[EView/);
    });

    test('exit 2: bad arguments, no src/, an unreadable --with report', () => {
        const bad = cli('--deep', 'x');
        assert.equal(bad.status, 2);
        assert.equal(bad.stderr.trim(), 'ERROR: --deep must be 0-10 (got: x)');
        const dir = mkdtempSync(join(tmpdir(), 'fields-types-'));
        try {
            const nosrc = cli('--root', dir);
            assert.equal(nosrc.status, 2);
            assert.match(nosrc.stderr, /^ERROR: no src\/ directory in /);
            const junk = join(dir, 'junk.json');
            writeFileSync(junk, '{"repo":"x"}');
            const r = cli('--root', FIXTURE, '--with', junk);
            assert.equal(r.status, 2);
            assert.match(r.stderr, /is not a fields-types report/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('--json then --with: the other repo is merged as the same index', () => {
        const dir = mkdtempSync(join(tmpdir(), 'fields-types-'));
        try {
            // a full report round-trips through --json.
            const json = cli('--root', FIXTURE, '--json', '--fail-on', 'none');
            assert.equal(json.status, 0, json.stderr);
            const own = JSON.parse(json.stdout);
            assert.equal(own.repo, 'fields-types');
            assert.equal(own.conflicts.length, 7);
            // another repo where `at` is a number: date vs number, order.
            const other = join(dir, 'other.json');
            const at = [{ name: 'at', type: 'number', file: 'src/x.ts', line: 9 }];
            writeFileSync(other, JSON.stringify(fakeReport('other-api', 'XModel', at)));
            const r = cli('--root', FIXTURE, '--with', other, '--fail-on', 'none');
            assert.equal(r.status, 0, r.stderr);
            assert.match(
                r.stdout,
                /^fields-types repo=fields-types\+other-api models=6 .* conflicts=8 \(hard=3 order=5\)/,
            );
            assert.match(
                r.stdout,
                /- order at: date\[fields-types:AModel\(src\/model\.ts:\d+\)\] vs number\[other-api:XModel\(src\/x\.ts:9\)\]/,
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
