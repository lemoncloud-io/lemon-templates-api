/**
 * `bin/lib/loop-check.mjs`
 * - check the loop test of the deployed service end to end: one admin invoke of `lambda` per kind
 *   (`POST /callback/<kind>/loop`), then the `[LOOP] send` / `[LOOP] recv` lines in CloudWatch.
 *   - `sns`, `sqs`: send in the `lambda` log group, recv in the `backend` log group.
 *   - `protocol`: send and recv both in the `lambda` log group (`//self` is the `lambda` function).
 *   - `notify`, `enqueue`: protocol service over SNS / SQS; send in `lambda`, recv (`loop-recv`) in `backend`.
 * - exactly one invoke per kind, no retry; the log poll stops at `--timeout`.
 * - all logic of `bin/loop-check.mjs`: no `process.exit`; the Lambda invoker, the log fetch, the STS banner,
 *   the clock, and the printers are injectable, so the tests run offline.
 */
import {
    parseArgs,
    resolveAws,
    functionName,
    checkStage,
    outputFilter,
    maskHeaders,
    resolveIdentity,
    stripControl,
    HarnessError,
    ArgError,
    DEFAULT_REGION,
} from './common.mjs';
import { webEvent } from './event.mjs';

// every loop kind, in the order of `--kind all`.
export const KINDS = ['sns', 'sqs', 'protocol', 'notify', 'enqueue'];

// identity of the admin trigger (lemon-core reads it on internal calls only).
export const ADMIN_IDENTITY = '{"roles":["admin"]}';

// note sent in the trigger body (echoed in the loop payload).
export const NOTE = 'loop:check';

// default and allowed range of `--timeout` (ms).
export const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

// poll interval of the log query (ms).
export const DEFAULT_INTERVAL_MS = 2000;

// the log query starts this long before the invoke (clock skew and ingestion slack).
export const LOOKBACK_MS = 60 * 1000;

// help text for `--help`.
export const HELP = [
    'Check the SNS / SQS / protocol / notify / enqueue loop test of the deployed service from its CloudWatch log lines.',
    '',
    'usage: node bin/loop-check.mjs [options]',
    '       npm run loop:check -- [options]',
    '',
    'per kind: one internal admin invoke of `lambda` (POST /callback/<kind>/loop), then a poll of the log lines',
    '  sns, sqs, notify, enqueue:  [LOOP] send in the lambda log group, [LOOP] recv in the backend log group',
    '  protocol:                   [LOOP] send and [LOOP] recv both in the lambda log group',
    '',
    'options:',
    '  --kind <k>              sns | sqs | protocol | notify | enqueue | all (default: all)',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --confirm-stage <stage> required for any stage other than dev (same value as the stage)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain)',
    `  --timeout <ms>          max wait for the log lines per kind, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (default: ${DEFAULT_TIMEOUT_MS})`,
    '  --json                  print { stage, functions, results } only',
    '  --dry                   print the targets and the events, do not call AWS',
    '  --help                  show this help',
    '',
    'exit codes: 0 = every kind received; 1 = any missing, timeout, non-200, or AWS error; 2 = bad arguments.',
];

// flags that never take a value.
const BOOLEANS = ['json', 'dry', 'help'];

// every accepted option.
const KNOWN = ['kind', 'stage', 'confirm-stage', 'region', 'profile', 'timeout', ...BOOLEANS];

// UUID shape of a loop id.
const LOOP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// a safe message id to print (AWS ids are short word/dash strings).
const MESSAGE_ID_RE = /^[\w-]{1,128}$/;

// parse argv strictly and check the values (throws `ArgError`).
export const parseOptions = argv => {
    const opts = parseArgs(argv, { booleans: BOOLEANS, known: KNOWN, maxPositional: 0 });
    if (opts.help) return opts;
    // `--kind`: one kind or all.
    const kind = opts.kind === undefined ? 'all' : opts.kind;
    if (!(kind === 'all' || KINDS.includes(kind))) {
        throw new ArgError(`--kind must be sns, sqs, protocol, notify, enqueue or all (got: ${kind})`);
    }
    // `--timeout`: an integer within the range.
    const t = opts.timeout;
    const okT =
        t === undefined || (typeof t === 'string' && /^\d+$/.test(t) && +t >= MIN_TIMEOUT_MS && +t <= MAX_TIMEOUT_MS);
    if (!okT) throw new ArgError(`--timeout needs an integer ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (got: ${t})`);
    return {
        ...opts,
        kinds: kind === 'all' ? [...KINDS] : [kind],
        timeoutMs: t === undefined ? DEFAULT_TIMEOUT_MS : Number(t),
    };
};

// the trigger event of one kind: internal web event (no Host) with the admin identity.
export const triggerEvent = (kind, stage) =>
    webEvent(
        {
            method: 'POST',
            path: `/callback/${kind}/loop`,
            internal: true,
            identity: ADMIN_IDENTITY,
            body: JSON.stringify({ note: NOTE }),
        },
        stage,
    );

// log groups of one kind: where the send line and the recv line appear.
export const logGroups = (kind, names) => ({
    send: `/aws/lambda/${names.lambda}`,
    recv: `/aws/lambda/${kind === 'protocol' ? names.lambda : names.backend}`,
});

// parse a JSON text, or return undefined.
const tryJson = text => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

// the web response of one invoke → `{ http, body, issue }` (`issue` when the invoke itself failed).
export const readResponse = r => {
    if (r.functionError || !(r.statusCode >= 200 && r.statusCode < 300)) {
        const issue = `lambda invoke failed: status=${r.statusCode} function-error=${r.functionError || 'none'}`;
        return { http: null, body: null, issue: `${issue}: ${`${r.text ?? ''}`.trim()}` };
    }
    const payload = r.text ? tryJson(r.text) : undefined;
    if (!payload || typeof payload !== 'object' || !('statusCode' in payload)) {
        return { http: null, body: null, issue: `not a web response: ${`${r.text ?? ''}`.trim()}` };
    }
    const http = Number(payload.statusCode);
    const raw = payload.body;
    // the handler answers a JSON text (or an object when already parsed).
    const body = typeof raw === 'string' ? tryJson(raw) ?? raw : raw;
    if (http !== 200) return { http, body: null, issue: `expected http 200 got ${http}: ${`${raw ?? ''}`.trim()}` };
    return { http, body, issue: null };
};

// check the trigger answer of one kind → `{ loopId, messageId, issues }`.
export const checkAnswer = (kind, body) => {
    const issues = [];
    const B = body && typeof body === 'object' ? body : {};
    const loopId = LOOP_ID_RE.test(`${B.loopId ?? ''}`) ? B.loopId : null;
    if (!loopId) issues.push('no valid loopId in the response');
    if (B.kind !== kind) issues.push(`expected kind=${kind} got ${B.kind ?? '-'}`);
    const messageId = MESSAGE_ID_RE.test(`${B.messageId ?? ''}`) ? B.messageId : null;
    // sns/sqs/notify/enqueue: a message id from AWS; protocol: the receiver's result with the same loop id.
    if (kind !== 'protocol' && !messageId) issues.push('no messageId in the response');
    if (kind === 'protocol' && (!loopId || B.result?.loopId !== loopId)) {
        issues.push('protocol result.loopId does not match');
    }
    return { loopId, messageId, issues };
};

// escape a literal for use inside a RegExp.
const escapeRe = s => `${s}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// find the send / recv lines of one loop in log events → `{ send, recv, latency }`.
export const findLines = (events, kind, loopId) => {
    const id = escapeRe(loopId);
    const sendRe = new RegExp(`\\[LOOP\\] send kind=${kind} loop=${id} message=`);
    const recvRe = new RegExp(`\\[LOOP\\] recv kind=${kind} loop=${id} latency=(\\d+)ms`);
    const found = { send: false, recv: false, latency: null };
    // ANSI color codes of the lemon-core logger are stripped first.
    for (const ev of events || []) {
        const text = stripControl(ev?.message ?? '');
        if (sendRe.test(text)) found.send = true;
        const m = text.match(recvRe);
        if (m) {
            found.recv = true;
            found.latency = Number(m[1]);
        }
    }
    return found;
};

// wait for the given milliseconds.
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// a log group not created yet (no invoke so far) reads as no events.
const isMissingGroup = e => e?.name === 'ResourceNotFoundException';

// poll the log groups for one loop until both lines are seen or `timeoutMs` passes (no other retry).
// → `{ send, recv, latency, timedOut, polls }`.
export const waitForLines = async (
    fetch,
    {
        kind,
        loopId,
        groups,
        startTime,
        timeoutMs,
        intervalMs = DEFAULT_INTERVAL_MS,
        sleep = defaultSleep,
        now = Date.now,
    },
) => {
    const t0 = now();
    const state = { send: false, recv: false, latency: null };
    const filterPattern = `"${loopId}"`;
    // one query of a group (a missing group is empty).
    const query = group =>
        fetch({ logGroupName: group, filterPattern, startTime }).catch(e => {
            if (isMissingGroup(e)) return [];
            throw e;
        });
    let polls = 0;
    for (;;) {
        polls++;
        // query only the groups still needed (one query when send and recv share a group).
        const need = [...new Set([!state.send && groups.send, !state.recv && groups.recv].filter(Boolean))];
        for (const group of need) {
            const got = findLines(await query(group), kind, loopId);
            if (group === groups.send && got.send) state.send = true;
            if (group === groups.recv && got.recv) Object.assign(state, { recv: true, latency: got.latency });
        }
        if (state.send && state.recv) return { ...state, timedOut: false, polls };
        // the hard timeout: stop when the next poll would pass it.
        if (now() - t0 + intervalMs > timeoutMs) return { ...state, timedOut: true, polls };
        await sleep(intervalMs);
    }
};

// check one kind: one invoke, then the log poll → result record.
export const checkKind = async (kind, { stage, names, timeoutMs, invoke, fetch, sleep, now, intervalMs }) => {
    const clock = now || Date.now;
    const startTime = clock() - LOOKBACK_MS;
    const base = { kind, loopId: null, messageId: null, http: null, send: false, recv: false, latency: null };
    // exactly one invoke per kind (never retried).
    const res = readResponse(await invoke(triggerEvent(kind, stage)));
    if (res.issue) return { ...base, http: res.http, issues: [res.issue] };
    const answer = checkAnswer(kind, res.body);
    const record = { ...base, http: res.http, loopId: answer.loopId, messageId: answer.messageId };
    if (!answer.loopId) return { ...record, issues: answer.issues };
    const groups = logGroups(kind, names);
    const opts = { kind, loopId: answer.loopId, groups, startTime, timeoutMs, intervalMs, sleep, now: clock };
    const seen = await waitForLines(fetch, opts);
    const issues = [...answer.issues];
    if (!seen.send) issues.push(`no [LOOP] send line in ${groups.send}`);
    if (!seen.recv) issues.push(`no [LOOP] recv line in ${groups.recv}`);
    if (seen.timedOut) issues.push(`timeout after ${timeoutMs}ms`);
    return { ...record, send: seen.send, recv: seen.recv, latency: seen.latency, issues };
};

// one result line: `loop kind=<k> loop=<id> send=<ok|missing> recv=<ok|missing> latency=<ms|->`.
export const resultLine = r =>
    `loop kind=${r.kind} loop=${r.loopId || '-'} send=${r.send ? 'ok' : 'missing'} recv=${r.recv ? 'ok' : 'missing'}` +
    ` latency=${r.latency === null || r.latency === undefined ? '-' : r.latency}`;

// a kind passes with no issue and both lines seen.
export const passed = r => r.send && r.recv && r.issues.length === 0;

// exit code of all results: 0 only when every kind passed.
export const exitCode = results => (results.length > 0 && results.every(passed) ? 0 : 1);

// default Lambda invoker for the resolved SDK config (SDK loaded only when needed).
const defaultInvoker = (aws, name) => {
    let client = null;
    return async event => {
        const { createClient, invokeLambda } = await import('./invoke.mjs');
        client = client || createClient(aws);
        return invokeLambda(client, { name, event });
    };
};

// default log fetch (paged `FilterLogEvents`, SDK loaded only when needed).
const defaultFetch = aws => {
    let client = null;
    return async params => {
        const { createLogsClient, fetchAll } = await import('./logs.mjs');
        client = client || createLogsClient(aws);
        return fetchAll(client, params);
    };
};

// run the check; returns the exit code. deps: `{ invoke, fetch, identity, log, error, sleep, now, intervalMs }`.
export const run = async (argv, deps = {}) => {
    const log = deps.log || (s => console.log(s));
    const error = deps.error || (s => console.error(s));
    const out = outputFilter();
    try {
        const opts = parseOptions(argv);
        if (opts.help) {
            log(HELP.join('\n'));
            return 0;
        }
        // stage guard before anything else touches the target.
        const stage = checkStage({ stage: opts.stage, confirm: opts['confirm-stage'] });
        const aws = resolveAws(opts);
        const names = {
            lambda: functionName({ stage, fn: 'lambda' }),
            backend: functionName({ stage, fn: 'backend' }),
        };
        const head = `loop-check stage=${stage} lambda=${names.lambda} backend=${names.backend}`;

        // --dry: the targets and each event (identity header masked), never call AWS.
        if (opts.dry) {
            log(`${head} kinds=${opts.kinds.join(',')} timeout=${opts.timeoutMs}ms region=${aws.region} (dry)`);
            for (const kind of opts.kinds) {
                const g = logGroups(kind, names);
                log(`--- kind=${kind}: invoke ${names.lambda}, send in ${g.send}, recv in ${g.recv} ---`);
                log(JSON.stringify(maskHeaders(triggerEvent(kind, stage)), null, 2));
            }
            return 0;
        }

        // identity banner first; an STS failure stops before Lambda or Logs is called.
        error(await (deps.identity || resolveIdentity)(aws, opts, names.lambda));
        if (!opts.json) log(head);
        const ctx = {
            stage,
            names,
            timeoutMs: opts.timeoutMs,
            invoke: deps.invoke || defaultInvoker(aws, names.lambda),
            fetch: deps.fetch || defaultFetch(aws),
            sleep: deps.sleep,
            now: deps.now,
            intervalMs: deps.intervalMs ?? DEFAULT_INTERVAL_MS,
        };
        // the kinds one after another (one invoke each).
        const results = [];
        for (const kind of opts.kinds) {
            const r = await checkKind(kind, ctx);
            results.push(r);
            if (!opts.json) {
                log(resultLine(r));
                r.issues.forEach(s => log(`  - ${out.text(s)}`));
            }
        }
        // --json: one object; the issue texts are redacted (other values are validated above).
        if (opts.json) {
            const safe = results.map(r => ({ ...r, issues: r.issues.map(s => out.text(s)) }));
            log(JSON.stringify({ stage, functions: names, results: safe }));
        }
        return exitCode(results);
    } catch (e) {
        // harness errors keep their exit code; anything else (SDK) is redacted and exits 1.
        if (e instanceof HarnessError) {
            error(`ERROR: ${e.message}`);
            return e.code;
        }
        error(`ERROR: ${out.log(`${e?.name || 'Error'}: ${e?.message ?? e}`)}`);
        return 1;
    }
};
