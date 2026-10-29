/**
 * `bin/lib/loop-check.test.mjs`
 * - offline tests for `loop-check.mjs` (fake Lambda invoker, fake log fetch, fake clock; no AWS).
 * - run: `npm run lambda:test`
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    run,
    parseOptions,
    findLines,
    waitForLines,
    logGroups,
    triggerEvent,
    resultLine,
    KINDS,
} from './loop-check.mjs';
import { functionName, ArgError } from './common.mjs';

// the CLI entry, run with `--dry` / `--help` / bad arguments only (no AWS call).
const SCRIPT = fileURLToPath(new URL('../loop-check.mjs', import.meta.url));

// the function names and log groups of dev.
const LAMBDA = functionName({ stage: 'dev', fn: 'lambda' });
const BACKEND = functionName({ stage: 'dev', fn: 'backend' });
const G_LAMBDA = `/aws/lambda/${LAMBDA}`;
const G_BACKEND = `/aws/lambda/${BACKEND}`;

// one loop id per kind (the fake trigger answers these).
const IDS = {
    sns: '11111111-1111-4111-8111-111111111111',
    sqs: '22222222-2222-4222-8222-222222222222',
    protocol: '33333333-3333-4333-8333-333333333333',
};

// a lemon-core `_inf` line as CloudWatch keeps it (ANSI colors, request id, level).
const line = body => `2026-10-30T00:00:00.000Z\tabc\tINFO\t\x1b[33mloop:\x1b[0m ${body}\n`;

// the send / recv log lines of a kind.
const sendLine = kind =>
    line(`[LOOP] send kind=${kind} loop=${IDS[kind]} message=${kind === 'protocol' ? '-' : 'm-1'}`);
const recvLine = (kind, ms = 42) =>
    line(`[LOOP] recv kind=${kind} loop=${IDS[kind]} latency=${ms}ms${kind === 'protocol' ? ' hop=1' : ''}`);

// a fake invoker: answers the trigger of each kind with `http` and its body; records each event.
const fakeInvoke = ({ http = 200, functionError, body } = {}) => {
    const events = [];
    const fn = async event => {
        events.push(event);
        const kind = event.path.split('/')[2];
        const loopId = IDS[kind];
        const ok =
            kind === 'protocol'
                ? { kind, loopId, sentAt: 1, result: { loopId, recvAt: 2, hop: 1 } }
                : { kind, loopId, messageId: `mid-${kind}`, sentAt: 1 };
        const payload = { statusCode: http, body: http === 200 ? JSON.stringify(body ? body(kind) : ok) : 'nope' };
        return { statusCode: 200, functionError, text: JSON.stringify(payload), took: 1 };
    };
    return Object.assign(fn, { events });
};

// a fake log fetch: `logs[group]` is the list of messages it holds; filters by the quoted term; records each query.
const fakeFetch = (logs, { fail } = {}) => {
    const queries = [];
    const fn = async params => {
        queries.push(params);
        if (fail) throw fail;
        const term = params.filterPattern.replace(/^"|"$/g, '');
        return (logs[params.logGroupName] || []).filter(m => m.includes(term)).map(message => ({ message }));
    };
    return Object.assign(fn, { queries });
};

// every line of a good run, per group.
const GOOD_LOGS = {
    [G_LAMBDA]: [sendLine('sns'), sendLine('sqs'), sendLine('protocol'), recvLine('protocol', 7)],
    [G_BACKEND]: [recvLine('sns', 120), recvLine('sqs', 300)],
};

// a fake clock: `sleep` moves it forward.
const fakeClock = () => {
    let t = 1_000_000;
    const sleeps = [];
    return { now: () => t, sleep: async ms => (sleeps.push(ms), (t += ms)), sleeps };
};

// run with captured output, a fake STS banner and a fake clock; returns `{ code, out, err, lines }`.
const call = async (argv, deps = {}) => {
    const out = [];
    const err = [];
    const clock = fakeClock();
    const identity = async () => `account=****0000 region=x credentials=default-chain function=${LAMBDA}`;
    const code = await run(argv, {
        log: s => out.push(s),
        error: s => err.push(s),
        identity,
        now: clock.now,
        sleep: clock.sleep,
        intervalMs: 2000,
        ...deps,
    });
    return { code, out: out.join('\n'), err: err.join('\n'), lines: out.join('\n').split('\n'), clock };
};

// assert that `fn` throws an `ArgError` (code 2) whose message matches `re`.
const throwsArg = (fn, re) =>
    assert.throws(fn, e => e instanceof ArgError && e.code === 2 && re.test(e.message), `expected ArgError ${re}`);

describe('loop-check arguments', () => {
    test('unknown option, extra argument, bad --kind or --timeout exit 2', async () => {
        const unknown = await call(['--foo']);
        assert.equal(unknown.code, 2);
        assert.equal(unknown.err, 'ERROR: unknown option --foo (see --help)');
        const extra = await call(['sns']);
        assert.equal(extra.code, 2);
        assert.equal(extra.err, 'ERROR: unknown argument sns (see --help)');
        throwsArg(() => parseOptions(['--kind', 'kafka']), /^--kind must be sns, sqs, protocol or all \(got: kafka\)$/);
        throwsArg(() => parseOptions(['--timeout', '999']), /^--timeout needs an integer 1000-600000/);
        throwsArg(() => parseOptions(['--timeout', '600001']), /^--timeout needs an integer/);
        throwsArg(() => parseOptions(['--timeout', 'x']), /^--timeout needs an integer/);
        throwsArg(() => parseOptions(['--name', 'x']), /^unknown option --name/);
    });
    test('defaults: all kinds, 60000 ms', () => {
        const o = parseOptions([]);
        assert.deepEqual(o.kinds, KINDS);
        assert.deepEqual(KINDS, ['sns', 'sqs', 'protocol']);
        assert.equal(o.timeoutMs, 60000);
        assert.deepEqual(parseOptions(['--kind', 'sqs', '--timeout', '5000']).kinds, ['sqs']);
        assert.equal(parseOptions(['--kind', 'all']).kinds.length, 3);
    });
    test('the stage guard exits 2 before any AWS call', async () => {
        const invoke = fakeInvoke();
        const r = await call(['--stage', 'prod'], { invoke });
        assert.equal(r.code, 2);
        assert.equal(r.err, 'ERROR: stage "prod" needs --confirm-stage prod');
        assert.equal(invoke.events.length, 0);
    });
    test('--help exits 0 with any other argument', async () => {
        const r = await call(['--help', '--foo']);
        assert.equal(r.code, 0);
        assert.match(r.lines[0], /loop test of the deployed service/);
    });
});

describe('loop-check run', () => {
    test('every kind received: exit 0, one line per kind', async () => {
        const invoke = fakeInvoke();
        const fetch = fakeFetch(GOOD_LOGS);
        const r = await call([], { invoke, fetch });
        assert.equal(r.code, 0, r.out);
        assert.deepEqual(r.lines, [
            `loop-check stage=dev lambda=${LAMBDA} backend=${BACKEND}`,
            `loop kind=sns loop=${IDS.sns} send=ok recv=ok latency=120`,
            `loop kind=sqs loop=${IDS.sqs} send=ok recv=ok latency=300`,
            `loop kind=protocol loop=${IDS.protocol} send=ok recv=ok latency=7`,
        ]);
        assert.match(r.err, /^account=\*\*\*\*0000 /);
        assert.equal(r.clock.sleeps.length, 0);
    });
    test('the trigger: one internal admin POST /callback/<kind>/loop per kind (guard 6: no retry)', async () => {
        const invoke = fakeInvoke();
        await call([], { invoke, fetch: fakeFetch(GOOD_LOGS) });
        assert.deepEqual(
            invoke.events.map(e => `${e.httpMethod} ${e.path}`),
            ['POST /callback/sns/loop', 'POST /callback/sqs/loop', 'POST /callback/protocol/loop'],
        );
        for (const e of invoke.events) {
            assert.ok(!Object.keys(e.headers).some(k => k.toLowerCase() === 'host'));
            assert.equal(e.headers['x-lemon-identity'], '{"roles":["admin"]}');
            assert.deepEqual(e.pathParameters, { id: e.path.split('/')[2], cmd: 'loop' });
            assert.equal(e.resource, '/callback/{id}/{cmd}');
        }
    });
    test('log queries: filtered by the loop id; sns/sqs recv in backend, protocol recv in lambda', async () => {
        const fetch = fakeFetch(GOOD_LOGS);
        await call([], { invoke: fakeInvoke(), fetch });
        const seen = fetch.queries.map(q => `${q.logGroupName} ${q.filterPattern}`);
        assert.deepEqual(seen, [
            `${G_LAMBDA} "${IDS.sns}"`,
            `${G_BACKEND} "${IDS.sns}"`,
            `${G_LAMBDA} "${IDS.sqs}"`,
            `${G_BACKEND} "${IDS.sqs}"`,
            `${G_LAMBDA} "${IDS.protocol}"`,
        ]);
        assert.ok(fetch.queries.every(q => typeof q.startTime === 'number'));
        assert.deepEqual(logGroups('protocol', { lambda: 'a', backend: 'b' }), {
            send: '/aws/lambda/a',
            recv: '/aws/lambda/a',
        });
    });
    test('recv missing: polls until the timeout, then exit 1 (one invoke only)', async () => {
        const invoke = fakeInvoke();
        const fetch = fakeFetch({ [G_LAMBDA]: [sendLine('sns')] });
        const r = await call(['--kind', 'sns', '--timeout', '10000'], { invoke, fetch });
        assert.equal(r.code, 1);
        assert.equal(r.lines[1], `loop kind=sns loop=${IDS.sns} send=ok recv=missing latency=-`);
        assert.deepEqual(r.lines.slice(2), [`  - no [LOOP] recv line in ${G_BACKEND}`, '  - timeout after 10000ms']);
        assert.equal(invoke.events.length, 1);
        // polls at 0, 2, 4, 6, 8, 10 s (the last one at the timeout): 5 sleeps, 6 polls;
        // the send group is not queried again once found.
        assert.deepEqual(r.clock.sleeps, [2000, 2000, 2000, 2000, 2000]);
        assert.equal(fetch.queries.filter(q => q.logGroupName === G_LAMBDA).length, 1);
        assert.equal(fetch.queries.filter(q => q.logGroupName === G_BACKEND).length, 6);
    });
    test('a line that arrives late is found on a later poll', async () => {
        const logs = { [G_LAMBDA]: [sendLine('sqs')], [G_BACKEND]: [] };
        const fetch = fakeFetch(logs);
        const clock = fakeClock();
        const sleep = async ms => {
            await clock.sleep(ms);
            logs[G_BACKEND] = [recvLine('sqs', 900)];
        };
        const r = await call(['--kind', 'sqs'], { invoke: fakeInvoke(), fetch, now: clock.now, sleep });
        assert.equal(r.code, 0, r.out);
        assert.equal(r.lines[1], `loop kind=sqs loop=${IDS.sqs} send=ok recv=ok latency=900`);
        assert.deepEqual(clock.sleeps, [2000]);
    });
    test('non-200 http: exit 1, no log poll', async () => {
        const fetch = fakeFetch(GOOD_LOGS);
        const r = await call(['--kind', 'sns'], { invoke: fakeInvoke({ http: 403 }), fetch });
        assert.equal(r.code, 1);
        assert.deepEqual(r.lines.slice(1), [
            'loop kind=sns loop=- send=missing recv=missing latency=-',
            '  - expected http 200 got 403: nope',
        ]);
        assert.equal(fetch.queries.length, 0);
    });
    test('a FunctionError exits 1', async () => {
        const r = await call(['--kind', 'sqs'], { invoke: fakeInvoke({ functionError: 'Unhandled' }) });
        assert.equal(r.code, 1);
        assert.match(r.out, /lambda invoke failed: status=200 function-error=Unhandled/);
    });
    test('protocol: a result with another loop id exits 1', async () => {
        const body = kind => ({ kind, loopId: IDS[kind], sentAt: 1, result: { loopId: IDS.sns } });
        const r = await call(['--kind', 'protocol'], { invoke: fakeInvoke({ body }), fetch: fakeFetch(GOOD_LOGS) });
        assert.equal(r.code, 1);
        assert.ok(r.lines.includes('  - protocol result.loopId does not match'));
        assert.match(r.lines[1], / send=ok recv=ok latency=7$/);
    });
    test('a Logs error exits 1 with the error redacted; a missing log group reads as empty', async () => {
        const fail = Object.assign(new Error('denied for arn:aws:iam::123456789012:user/x'), {
            name: 'AccessDeniedException',
        });
        const r = await call(['--kind', 'sns'], { invoke: fakeInvoke(), fetch: fakeFetch({}, { fail }) });
        assert.equal(r.code, 1);
        assert.equal(r.err.split('\n').at(-1), 'ERROR: AccessDeniedException: denied for <arn>');
        const missing = Object.assign(new Error('no group'), { name: 'ResourceNotFoundException' });
        const m = await call(['--kind', 'sns', '--timeout', '1000'], {
            invoke: fakeInvoke(),
            fetch: fakeFetch({}, { fail: missing }),
        });
        assert.equal(m.code, 1);
        assert.match(m.out, /send=missing recv=missing/);
    });
    test('--json prints { stage, functions, results } only', async () => {
        const r = await call(['--kind', 'sns', '--json'], { invoke: fakeInvoke(), fetch: fakeFetch(GOOD_LOGS) });
        assert.equal(r.code, 0);
        const json = JSON.parse(r.out);
        assert.deepEqual(Object.keys(json), ['stage', 'functions', 'results']);
        assert.deepEqual(json.functions, { lambda: LAMBDA, backend: BACKEND });
        assert.deepEqual(json.results, [
            {
                kind: 'sns',
                loopId: IDS.sns,
                messageId: 'mid-sns',
                http: 200,
                send: true,
                recv: true,
                latency: 120,
                issues: [],
            },
        ]);
    });
});

describe('loop-check helpers and --dry', () => {
    test('findLines strips ANSI codes and reads the latency', () => {
        const got = findLines([{ message: sendLine('sns') }, { message: recvLine('sns', 55) }], 'sns', IDS.sns);
        assert.deepEqual(got, { send: true, recv: true, latency: 55 });
        // another kind or loop id does not match.
        assert.deepEqual(findLines([{ message: recvLine('sns') }], 'sqs', IDS.sns), {
            send: false,
            recv: false,
            latency: null,
        });
        assert.equal(findLines([{ message: recvLine('sqs') }], 'sqs', IDS.sns).recv, false);
    });
    test('waitForLines never polls past the timeout', async () => {
        const clock = fakeClock();
        const fetch = fakeFetch({});
        const groups = { send: 'a', recv: 'b' };
        const r = await waitForLines(fetch, {
            kind: 'sns',
            loopId: IDS.sns,
            groups,
            startTime: 0,
            timeoutMs: 5000,
            intervalMs: 2000,
            now: clock.now,
            sleep: clock.sleep,
        });
        // polls at 0, 2, 4 s; a poll at 6 s would pass the 5 s timeout.
        assert.deepEqual(r, { send: false, recv: false, latency: null, timedOut: true, polls: 3 });
        assert.deepEqual(clock.sleeps, [2000, 2000]);
    });
    test('resultLine format', () => {
        const r = { kind: 'sqs', loopId: IDS.sqs, send: true, recv: false, latency: null, issues: [] };
        assert.equal(resultLine(r), `loop kind=sqs loop=${IDS.sqs} send=ok recv=missing latency=-`);
        assert.equal(triggerEvent('sns', 'dev').body, '{"note":"loop:check"}');
    });
    test('--dry prints the targets and the events with the identity masked, no AWS call (no stderr)', () => {
        const r = spawnSync(process.execPath, [SCRIPT, '--dry'], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stderr, '');
        const lines = r.stdout.split('\n');
        assert.equal(
            lines[0],
            `loop-check stage=dev lambda=${LAMBDA} backend=${BACKEND} kinds=sns,sqs,protocol timeout=60000ms region=${
                process.env.AWS_REGION || 'ap-northeast-2'
            } (dry)`,
        );
        assert.ok(lines.includes(`--- kind=sns: invoke ${LAMBDA}, send in ${G_LAMBDA}, recv in ${G_BACKEND} ---`));
        assert.ok(lines.includes(`--- kind=protocol: invoke ${LAMBDA}, send in ${G_LAMBDA}, recv in ${G_LAMBDA} ---`));
        assert.match(r.stdout, /"x-lemon-identity": "<redacted>"/);
        assert.match(r.stdout, /"path": "\/callback\/sqs\/loop"/);
        assert.doesNotMatch(r.stdout, /"host"/i);
    });
    test('the stage guard runs before --dry', () => {
        const r = spawnSync(process.execPath, [SCRIPT, '--stage', 'prod', '--dry'], { encoding: 'utf8' });
        assert.equal(r.status, 2);
        assert.equal(r.stderr.trim(), 'ERROR: stage "prod" needs --confirm-stage prod');
    });
});
