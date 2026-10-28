#!/usr/bin/env node
/**
 * `bin/lambda-logs.mjs`
 * - print (and optionally follow) CloudWatch logs of the deployed Lambda by polling `FilterLogEvents`.
 * - usage: `npm run lambda:logs -- --stage dev --profile <name> --follow --perf`
 */
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { parseArgs, resolveAws, functionName, parseSince, printHelp, fail, DEFAULT_REGION } from './lib/common.mjs';

// help text for `--help`.
const HELP = [
    'Print CloudWatch logs of the deployed Lambda (polling FilterLogEvents).',
    '',
    'usage: node bin/lambda-logs.mjs [options]',
    '       npm run lambda:logs -- [options]',
    '',
    'target:',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --function, --fn <fn>   lambda | backend (default: lambda)',
    '  --name <name>           full function name (overrides <service>-<stage>-<fn>)',
    '  --group <log-group>     log group (default: /aws/lambda/<name>)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain; AWS_PROFILE also works)',
    '',
    'filter:',
    '  --since <t>             30s | 5m | 2h | 1d | ISO date (default: 5m)',
    '  --filter <pattern>      CloudWatch filter pattern (server side)',
    '  --grep <regex>          case-insensitive regex on the message (client side)',
    "  --perf                  shortcut for --grep 'PERF:'",
    '',
    'output:',
    '  --follow, -f            keep polling until Ctrl-C',
    '  --interval <sec>        poll interval with --follow (default: 2)',
    '  --json                  one JSON object per line: { ts, stream, message }',
    '  --help                  show this help',
    '',
    'exit codes: 0 = ok, 1 = AWS error, 2 = bad arguments or log group not found.',
];

// flags that never take a value.
const BOOLEANS = ['follow', 'perf', 'json', 'help'];

// re-scan window in follow mode, so late-ingested events from other streams are not missed.
const LAG_MS = 10 * 1000;

// pad a number with leading zeros.
const pad = (n, w = 2) => `${n}`.padStart(w, '0');

// format epoch ms as local `YYYY-MM-DD HH:mm:ss.SSS`.
const fmtTime = ms => {
    const d = new Date(ms);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

// wait for the given milliseconds.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// fetch all pages from startTime; returns events sorted by timestamp.
const fetchAll = async (client, params) => {
    const events = [];
    let nextToken;
    // follow nextToken until the last page.
    do {
        const resp = await client.send(new FilterLogEventsCommand({ ...params, nextToken }));
        events.push(...(resp.events || []));
        nextToken = resp.nextToken;
    } while (nextToken);
    return events.sort((a, b) => a.timestamp - b.timestamp);
};

// entry point.
const main = async () => {
    const opts = parseArgs(process.argv.slice(2), { booleans: BOOLEANS, aliases: { f: 'follow', fn: 'function' } });
    if (opts.help) return printHelp(HELP);
    const aws = resolveAws(opts);
    const group = typeof opts.group === 'string' && opts.group ? opts.group : `/aws/lambda/${functionName(opts)}`;
    const since = parseSince(opts.since);
    const follow = !!opts.follow;
    const interval = Math.max(1, Number(opts.interval) || 2) * 1000;
    // client-side regex (--perf wins over --grep).
    const pattern = opts.perf ? 'PERF:' : typeof opts.grep === 'string' ? opts.grep : null;
    let grep = null;
    try {
        grep = pattern ? new RegExp(pattern, 'i') : null;
    } catch (e) {
        fail(`invalid --grep regex: ${e.message}`, 2);
    }
    const filterPattern = typeof opts.filter === 'string' && opts.filter ? opts.filter : undefined;

    console.error(`logs ${group} since=${new Date(since).toISOString()} follow=${follow}`);
    process.on('SIGINT', () => process.exit(0));

    const client = new CloudWatchLogsClient(aws);
    const seen = new Map(); // eventId -> timestamp, for dedupe across polls.
    let startTime = since;
    let maxTs = since;

    // poll once (or forever with --follow).
    for (;;) {
        const events = await fetchAll(client, { logGroupName: group, startTime, filterPattern }).catch(e => {
            // a missing log group is a clear, named error (exit 2).
            if (e?.name === 'ResourceNotFoundException') {
                fail(`log group not found: ${group} (not deployed yet, or wrong --stage/--region/--profile?)`, 2);
            }
            throw e;
        });
        for (const ev of events) {
            // skip events already printed in an earlier poll.
            if (seen.has(ev.eventId)) continue;
            seen.set(ev.eventId, ev.timestamp);
            maxTs = Math.max(maxTs, ev.timestamp);
            const message = `${ev.message || ''}`.replace(/[\r\n]+$/, '');
            if (grep && !grep.test(message)) continue;
            const stream = `${ev.logStreamName || ''}`;
            if (opts.json) console.log(JSON.stringify({ ts: new Date(ev.timestamp).toISOString(), stream, message }));
            else console.log(`${fmtTime(ev.timestamp)}  ${stream.slice(-8)}  ${message}`);
        }
        if (!follow) break;
        // advance the window (keep a short re-scan lag) and drop dedupe ids older than it.
        startTime = Math.max(since, maxTs - LAG_MS);
        for (const [id, ts] of seen) if (ts < startTime) seen.delete(id);
        await sleep(interval);
    }
};

// report other SDK errors without a stack trace (exit 1).
main().catch(e => fail(`${e.name || 'Error'}: ${e.message}`, 1));
