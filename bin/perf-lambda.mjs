#!/usr/bin/env node
/**
 * `bin/perf-lambda.mjs`
 * - invoke the deployed Lambda `--runs` times with a web event and summarize cold / warm timings
 *   from the log tail (`REPORT` line + lemon-core `PERF: >` lines).
 * - usage: `npm run perf:lambda -- --stage dev --profile <name> --path /hello/0 --runs 5`
 */
import {
    parseArgs,
    resolveAws,
    functionName,
    printHelp,
    fail,
    checkStage,
    tryServiceName,
    parseMaxBytes,
    outputFilter,
    maskHeaders,
    resolveIdentity,
    HarnessError,
    ArgError,
    DEFAULT_REGION,
} from './lib/common.mjs';
import { webEvent, eventLabel } from './lib/event.mjs';
import { createClient, invokeLambda } from './lib/invoke.mjs';
import { parseTail, summarize, formatRuns, formatSummary, exitCode } from './lib/perf.mjs';

// default path (the hello route answers without any backend).
const DEFAULT_PATH = '/hello/0';

// default and allowed range of `--runs`.
const DEFAULT_RUNS = 5;
const MAX_RUNS = 100;

// allowed range of `--interval` (ms).
const MAX_INTERVAL = 60000;

// help text for `--help`.
const HELP = [
    'Invoke the deployed Lambda several times and summarize cold / warm timings from the log tail.',
    '',
    'usage: node bin/perf-lambda.mjs [options]',
    '       npm run perf:lambda -- [options]',
    '',
    'target:',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --confirm-stage <stage> required for any stage other than dev (same value as the stage)',
    '  --function, --fn <fn>   lambda | backend (default: lambda)',
    '  --name <name>           full function name (overrides <service>-<stage>-<fn>)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain; AWS_PROFILE also works)',
    '',
    'event (web only):',
    `  --path <path>           HTTP path (default: ${DEFAULT_PATH}); \`?a=1\` is moved into the query`,
    '  --method <METHOD>       HTTP method (default: GET)',
    '  --query k=v             query parameter (repeatable)',
    '  --header k:v            header (repeatable)',
    '  --internal              no Host header, like a direct invoke (lemon-core treats it as internal)',
    '',
    'run:',
    `  --runs <n>              number of invokes, 1-${MAX_RUNS} (default: ${DEFAULT_RUNS})`,
    `  --interval <ms>         pause between invokes, 0-${MAX_INTERVAL} (default: 0)`,
    '  --dry                   print the target, the event JSON and the runs, do not call AWS',
    '  --json                  print { target, runs, summary } only',
    '  --raw                   do not redact the output (control stripping and the size cap stay)',
    '  --max-bytes <n>         cap for one printed text (default: 65536; 0 = no cap)',
    '  --help                  show this help',
    '',
    'exit codes: 0 = every run http 2xx and no FunctionError, 1 = otherwise, 2 = bad arguments.',
];

// flags that never take a value.
const BOOLEANS = ['internal', 'dry', 'json', 'raw', 'help'];

// every accepted option (aliases resolve to these).
const KNOWN = [
    'stage',
    'confirm-stage',
    'function',
    'name',
    'region',
    'profile',
    'path',
    'method',
    'query',
    'header',
    'runs',
    'interval',
    'max-bytes',
    ...BOOLEANS,
];

// output filter for this run (redacting by default until the options are parsed).
let out = outputFilter();

// parse an integer option within `[min, max]` (throws `ArgError`).
const parseIntIn = (value, name, min, max, dflt) => {
    if (value === undefined) return dflt;
    const ok = typeof value === 'string' && /^\d+$/.test(value) && +value >= min && +value <= max;
    if (!ok) throw new ArgError(`--${name} needs an integer ${min}-${max} (got: ${value})`);
    return Number(value);
};

// parse a JSON text, or return undefined.
const tryJson = text => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

// web `statusCode` of the response payload as a number, or null.
const httpOf = text => {
    const payload = text ? tryJson(text) : undefined;
    const code = payload && typeof payload === 'object' ? Number(payload.statusCode) : NaN;
    return Number.isFinite(code) ? code : null;
};

// wait `ms` milliseconds.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// one invoke with the log tail → one run record.
const runOnce = async (client, name, event) => {
    const resp = await invokeLambda(client, { name, event, tail: true });
    const tail = resp.logResult ? Buffer.from(resp.logResult, 'base64').toString('utf8') : '';
    const { report, perf, lines } = parseTail(tail);
    return {
        status: resp.statusCode,
        http: httpOf(resp.text),
        functionError: resp.functionError || null,
        took: resp.took,
        report,
        perf,
        lines,
    };
};

// entry point.
const main = async () => {
    const opts = parseArgs(process.argv.slice(2), {
        booleans: BOOLEANS,
        aliases: { fn: 'function' },
        known: KNOWN,
        maxPositional: 0,
    });
    if (opts.help) return printHelp(HELP);
    out = outputFilter({ raw: !!opts.raw, maxBytes: parseMaxBytes(opts['max-bytes']) });
    const runs = parseIntIn(opts.runs, 'runs', 1, MAX_RUNS, DEFAULT_RUNS);
    const interval = parseIntIn(opts.interval, 'interval', 0, MAX_INTERVAL, 0);
    // stage guard before anything else touches the target.
    const hasName = typeof opts.name === 'string' && opts.name;
    checkStage({
        stage: opts.stage,
        confirm: opts['confirm-stage'],
        name: hasName ? opts.name : undefined,
        service: hasName ? tryServiceName() : null,
    });
    const stage = typeof opts.stage === 'string' && opts.stage ? opts.stage : 'dev';
    const aws = resolveAws(opts);
    const name = functionName(opts);
    // the web event of one run (a fresh requestId each time).
    const eventOpts = { ...opts, path: typeof opts.path === 'string' && opts.path ? opts.path : DEFAULT_PATH };
    const makeEvent = () => webEvent(eventOpts, stage);
    const first = makeEvent();
    const route = ` ${first.httpMethod} ${first.path}`;
    const label = eventLabel('web', opts);
    const head = `perf ${name} event=${label}${route} runs=${runs}`;

    // --dry: show the target, the event (sensitive headers masked) and the runs, never call AWS.
    if (opts.dry) {
        console.log(`${head} interval=${interval}ms region=${aws.region} (dry)`);
        console.log(JSON.stringify(maskHeaders(first), null, 2));
        return;
    }

    // identity banner first; an STS failure stops before Lambda is called.
    console.error(await resolveIdentity(aws, opts, name));
    if (!opts.json) console.log(head);

    // the runs, one after another (an AWS error stops the whole run with exit 1).
    const client = createClient(aws);
    const records = [];
    for (let i = 0; i < runs; i++) {
        if (i > 0 && interval > 0) await sleep(interval);
        records.push(await runOnce(client, name, i === 0 ? first : makeEvent()));
    }
    const summary = summarize(records);

    // --json: one object; string leaves redacted and capped.
    if (opts.json) {
        const fn = hasName ? null : opts.function || 'lambda';
        const target = { name, stage, fn, path: first.path, method: first.httpMethod, runs };
        console.log(JSON.stringify(out.json({ target, runs: records, summary })));
    } else {
        console.log(out.text(formatRuns(records)));
        console.log('--- summary (ms; memUsed in MB) ---');
        console.log(out.text(formatSummary(summary)));
    }
    process.exitCode = exitCode(records);
};

// run; harness errors keep their exit code, SDK errors are redacted and exit 1 (no stack trace).
main().catch(e => {
    if (e instanceof HarnessError) return fail(e.message, e.code);
    fail(out.log(`${e.name || 'Error'}: ${e.message}`), 1);
});
