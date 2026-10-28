#!/usr/bin/env node
/**
 * `bin/lambda-invoke.mjs`
 * - invoke the deployed Lambda (`<service>-<stage>-<function>`) with a generated test event.
 * - usage: `npm run lambda:invoke -- --stage dev --profile <name> --path /hello/0`
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
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
    DEFAULT_REGION,
} from './lib/common.mjs';

// help text for `--help`.
const HELP = [
    'Invoke the deployed Lambda with a generated event.',
    '',
    'usage: node bin/lambda-invoke.mjs [options]',
    '       npm run lambda:invoke -- [options]',
    '',
    'target:',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --confirm-stage <stage> required for any stage other than dev (same value as the stage)',
    '  --function, --fn <fn>   lambda | backend (default: lambda)',
    '  --name <name>           full function name (overrides <service>-<stage>-<fn>)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain; AWS_PROFILE also works)',
    '',
    'event:',
    '  --event <kind>          web | cron | sns | sqs | raw (default: web)',
    '  --method <METHOD>       HTTP method for web (default: GET)',
    '  --path <path>           HTTP path for web (default: /); `?a=1` is moved into the query',
    '  --query k=v             query parameter for web (repeatable)',
    '  --header k:v            header for web (repeatable)',
    '  --body <json>|@file     body for web, SNS Message, or SQS body',
    '  --subject <text>        SNS Subject (default: lambda-invoke)',
    '  --cron-name <name>      cron.name for cron (default: 1MIN)',
    '  --file <event.json>|-   event JSON for raw (`-` reads stdin)',
    '',
    'run:',
    '  --dry                   print the target and event JSON, do not call AWS',
    '  --tail                  request the last 4 KB of the log and print it',
    '  --async                 InvocationType=Event (no payload returned)',
    '  --json                  print the raw response payload only',
    '  --raw                   do not redact the output (control stripping and the size cap stay)',
    '  --max-bytes <n>         cap for one printed body / log (default: 65536; 0 = no cap)',
    '  --help                  show this help',
    '',
    'exit codes: 0 = StatusCode 2xx and no FunctionError, 1 = otherwise, 2 = bad arguments.',
];

// flags that never take a value.
const BOOLEANS = ['dry', 'tail', 'async', 'json', 'raw', 'help'];

// every accepted option (aliases resolve to these).
const KNOWN = [
    'stage',
    'confirm-stage',
    'function',
    'name',
    'region',
    'profile',
    'event',
    'method',
    'path',
    'query',
    'header',
    'body',
    'subject',
    'cron-name',
    'file',
    'max-bytes',
    ...BOOLEANS,
];

// output filter for this run (redacting by default until the options are parsed).
let out = outputFilter();

// read a `@file` reference, or return the literal value.
const readValue = value => {
    if (typeof value !== 'string') return null;
    if (!value.startsWith('@')) return value;
    try {
        return readFileSync(value.slice(1), 'utf8').replace(/\s+$/, '');
    } catch (e) {
        return fail(`cannot read ${value}: ${e.message}`, 2);
    }
};

// split `k<sep>v` pairs into an object of arrays (keeps repeated keys).
const toMulti = (list, sep) =>
    [].concat(list || []).reduce((M, item) => {
        const s = `${item}`;
        const at = s.indexOf(sep);
        if (at <= 0) fail(`expected k${sep}v, got: ${s}`, 2);
        const key = s.slice(0, at).trim();
        M[key] = [...(M[key] || []), s.slice(at + 1).trim()];
        return M;
    }, {});

// collapse multi-value map into single values (last one wins, like API Gateway).
const toSingle = multi => Object.fromEntries(Object.entries(multi).map(([k, v]) => [k, v[v.length - 1]]));

// derive API Gateway `resource` and `pathParameters` from the path (`/{type}/{id}/{cmd}` routes).
const toRoute = pathname => {
    const segs = pathname.split('/').filter(Boolean);
    if (segs.length < 2) return { resource: segs.length ? `/${segs[0]}` : '/', pathParameters: null };
    if (segs.length === 2) return { resource: `/${segs[0]}/{id}`, pathParameters: { id: segs[1] } };
    return { resource: `/${segs[0]}/{id}/{cmd}`, pathParameters: { id: segs[1], cmd: segs.slice(2).join('/') } };
};

// API Gateway REST (v1) proxy event.
const webEvent = (opts, stage) => {
    const method = `${opts.method || 'GET'}`.toUpperCase();
    const [pathname, qs = ''] = `${opts.path || '/'}`.split('?');
    // query from `--path ...?a=1` first, then `--query k=v`.
    const fromPath = qs ? qs.split('&').filter(Boolean) : [];
    const multiQuery = toMulti([...fromPath.map(decodeURIComponent), ...[].concat(opts.query || [])], '=');
    const body = readValue(opts.body);
    // default headers; `Host` marks the request as external like a real API Gateway call.
    const multiHeaders = {
        Host: ['localhost'],
        Accept: ['application/json'],
        'User-Agent': ['lambda-invoke'],
        ...(body !== null ? { 'Content-Type': ['application/json'] } : {}),
        ...toMulti(opts.header, ':'),
    };
    const { resource, pathParameters } = toRoute(pathname);
    const hasQuery = Object.keys(multiQuery).length > 0;
    return {
        resource,
        path: pathname,
        httpMethod: method,
        headers: toSingle(multiHeaders),
        multiValueHeaders: multiHeaders,
        queryStringParameters: hasQuery ? toSingle(multiQuery) : null,
        multiValueQueryStringParameters: hasQuery ? multiQuery : null,
        pathParameters,
        stageVariables: null,
        requestContext: {
            resourcePath: resource,
            httpMethod: method,
            path: pathname,
            stage,
            requestId: randomUUID(),
            identity: { sourceIp: '127.0.0.1', userAgent: 'lambda-invoke' },
            requestTimeEpoch: Date.now(),
        },
        body,
        isBase64Encoded: false,
    };
};

// CloudWatch schedule input (same shape as `input:` in serverless.yml).
const cronEvent = (opts, stage) => ({ cron: { name: opts['cron-name'] || '1MIN', stage } });

// SNS event with one record (no ARNs).
const snsEvent = opts => ({
    Records: [
        {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: '',
            Sns: {
                Type: 'Notification',
                MessageId: randomUUID(),
                TopicArn: '',
                Subject: opts.subject || 'lambda-invoke',
                Message: readValue(opts.body) ?? '{}',
                Timestamp: new Date().toISOString(),
                MessageAttributes: {},
            },
        },
    ],
});

// SQS event with one record (no ARNs).
const sqsEvent = (opts, stage, region) => ({
    Records: [
        {
            eventSource: 'aws:sqs',
            messageId: randomUUID(),
            receiptHandle: '',
            body: readValue(opts.body) ?? '{}',
            attributes: { ApproximateReceiveCount: '1', SentTimestamp: `${Date.now()}` },
            messageAttributes: {},
            eventSourceARN: '',
            awsRegion: region,
        },
    ],
});

// raw event JSON from `--file` (or stdin with `--file -`).
const rawEvent = opts => {
    if (typeof opts.file !== 'string') fail('--event raw needs --file <event.json> (or --file - for stdin)', 2);
    let text = '';
    try {
        text = readFileSync(opts.file === '-' ? 0 : opts.file, 'utf8');
    } catch (e) {
        fail(`cannot read ${opts.file}: ${e.message}`, 2);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        return fail(`invalid JSON in ${opts.file}: ${e.message}`, 2);
    }
};

// event builders by kind.
const BUILDERS = { web: webEvent, cron: cronEvent, sns: snsEvent, sqs: sqsEvent, raw: rawEvent };

// parse a JSON text, or return undefined.
const tryJson = text => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

// print a body: pretty JSON when it parses, else text; redacted, then the printed text is capped once.
const printBody = body => {
    const parsed = typeof body === 'string' ? tryJson(body) : undefined;
    if (parsed !== undefined) return console.log(out.cap(JSON.stringify(out.json(parsed, { cap: false }), null, 2)));
    console.log(out.text(body ?? ''));
};

// print the payload; for web responses print `http <code>` and the (pretty) body.
const printPayload = (kind, text) => {
    const payload = text ? tryJson(text) ?? null : null;
    // non-JSON or empty payload: print as text.
    if (payload === null) return text && console.log(out.text(text));
    if (kind === 'web' && payload && typeof payload === 'object' && 'statusCode' in payload) {
        console.log(`http ${payload.statusCode}`);
        return printBody(payload.body);
    }
    console.log(out.cap(JSON.stringify(out.json(payload, { cap: false }), null, 2)));
};

// print the raw payload for `--json`: string leaves redacted and capped, structure kept.
const printJson = text => {
    const payload = tryJson(text);
    console.log(payload === undefined ? out.text(text) : JSON.stringify(out.json(payload)));
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
    const kind = `${opts.event || 'web'}`;
    if (!BUILDERS[kind]) fail(`--event must be one of ${Object.keys(BUILDERS).join('|')} (got: ${kind})`, 2);
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
    const event = BUILDERS[kind](opts, stage, aws.region);
    const route = kind === 'web' ? ` ${event.httpMethod} ${event.path}` : '';

    // --dry: show the target and event (sensitive headers masked), never call AWS.
    if (opts.dry) {
        console.log(`invoke ${name} event=${kind}${route} region=${aws.region} (dry)`);
        console.log(JSON.stringify(maskHeaders(event), null, 2));
        return;
    }
    if (opts.tail && opts.async) console.error('WARN: --tail is ignored with --async');

    // identity banner first; an STS failure stops before Lambda is called.
    console.error(await resolveIdentity(aws, opts, name));

    const client = new LambdaClient(aws);
    const cmd = new InvokeCommand({
        FunctionName: name,
        InvocationType: opts.async ? 'Event' : 'RequestResponse',
        LogType: opts.tail && !opts.async ? 'Tail' : 'None',
        Payload: Buffer.from(JSON.stringify(event)),
    });
    const t0 = Date.now();
    const resp = await client.send(cmd);
    const took = Date.now() - t0;
    const text = resp.Payload ? new TextDecoder().decode(resp.Payload) : '';
    const ok = resp.StatusCode >= 200 && resp.StatusCode < 300 && !resp.FunctionError;

    // --json: raw payload only (redacted string values).
    if (opts.json) {
        if (text) printJson(text);
    } else {
        console.log(`invoke ${name} event=${kind}${route}`);
        console.log(`status=${resp.StatusCode} function-error=${resp.FunctionError || 'none'} took=${took}ms`);
        printPayload(kind, text);
        // decoded log tail (base64 in LogResult), control-stripped and redacted.
        if (resp.LogResult) {
            console.log('--- log tail ---');
            console.log(out.log(Buffer.from(resp.LogResult, 'base64').toString('utf8').replace(/\n+$/, '')));
        }
    }
    process.exitCode = ok ? 0 : 1;
};

// run; harness errors keep their exit code, SDK errors are redacted and exit 1 (no stack trace).
main().catch(e => {
    if (e instanceof HarnessError) return fail(e.message, e.code);
    fail(out.log(`${e.name || 'Error'}: ${e.message}`), 1);
});
