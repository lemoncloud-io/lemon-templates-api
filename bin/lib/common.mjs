/**
 * `bin/lib/common.mjs`
 * - shared helpers for `bin/lambda-invoke.mjs` and `bin/lambda-logs.mjs`.
 * - never reads `env/*.yml`; only the top-level `service:` line of `serverless.yml`.
 */
import { readFileSync } from 'node:fs';
import { fromIni } from '@aws-sdk/credential-providers';

// default region (same as `provider.region` default in `serverless.yml`).
export const DEFAULT_REGION = 'ap-northeast-2';

// flags that collect every occurrence into an array.
const ARRAY_FLAGS = ['header', 'query'];

// push a value into a key, as array for repeatable flags.
const assign = (out, key, value) => {
    if (ARRAY_FLAGS.includes(key)) out[key] = [...(out[key] || []), value];
    else out[key] = value;
};

// parse argv into `{ _: positional[], ...flags }`; `booleans` never consume the next token.
export const parseArgs = (argv, { booleans = [], aliases = {} } = {}) => {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        // `--` ends flag parsing.
        if (tok === '--') {
            out._.push(...argv.slice(i + 1));
            break;
        }
        // short flag like `-f` (boolean only), mapped through aliases.
        if (/^-[a-zA-Z]$/.test(tok)) {
            const key = aliases[tok.slice(1)] || tok.slice(1);
            assign(out, key, true);
            continue;
        }
        // positional argument.
        if (!tok.startsWith('--')) {
            out._.push(tok);
            continue;
        }
        const body = tok.slice(2);
        const eq = body.indexOf('=');
        // `--key=value` form.
        if (eq >= 0) {
            const key = aliases[body.slice(0, eq)] || body.slice(0, eq);
            assign(out, key, body.slice(eq + 1));
            continue;
        }
        const key = aliases[body] || body;
        // `--no-x` sets x=false.
        if (key.startsWith('no-')) {
            out[key.slice(3)] = false;
            continue;
        }
        // `--flag` boolean, or `--key value` (a lone `-` counts as a value, e.g. stdin).
        const next = argv[i + 1];
        const hasValue = next !== undefined && (next === '-' || !next.startsWith('-'));
        if (booleans.includes(key) || !hasValue) {
            assign(out, key, true);
        } else {
            assign(out, key, next);
            i++;
        }
    }
    return out;
};

// build SDK client config: region + optional named-profile credentials.
export const resolveAws = (opts = {}) => {
    const region = typeof opts.region === 'string' ? opts.region : process.env.AWS_REGION || DEFAULT_REGION;
    // without --profile, leave credentials undefined so the SDK default chain (incl. AWS_PROFILE) applies.
    if (typeof opts.profile === 'string' && opts.profile) {
        return { region, credentials: fromIni({ profile: opts.profile }) };
    }
    return { region };
};

// read `service:` from the repo-root `serverless.yml` with a simple regex.
export const readServiceName = () => {
    const file = new URL('../../serverless.yml', import.meta.url);
    let text = '';
    try {
        text = readFileSync(file, 'utf8');
    } catch (e) {
        fail(`cannot read serverless.yml (${e.message}); pass --name <function-name> instead`, 2);
    }
    const m = text.match(/^service:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*(#.*)?$/m);
    if (!m) fail('no top-level `service:` in serverless.yml; pass --name <function-name> instead', 2);
    return m[1];
};

// resolve the deployed function name: --name, else `<service>-<stage>-<fn>`.
export const functionName = (opts = {}) => {
    if (typeof opts.name === 'string' && opts.name) return opts.name;
    const stage = typeof opts.stage === 'string' && opts.stage ? opts.stage : 'dev';
    const fn = opts.function || opts.fn || 'lambda';
    // only the two functions defined in serverless.yml are accepted.
    if (!['lambda', 'backend'].includes(fn)) fail(`--function must be lambda or backend (got: ${fn})`, 2);
    return `${readServiceName()}-${stage}-${fn}`;
};

// time units for relative --since values.
const UNITS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

// parse `30s` / `5m` / `2h` / `1d` / ISO date / epoch-ms into epoch ms (default `5m`).
export const parseSince = (str, now = Date.now()) => {
    const s = typeof str === 'string' && str ? str.trim() : '5m';
    const rel = s.match(/^(\d+)([smhd])$/);
    if (rel) return now - Number(rel[1]) * UNITS[rel[2]];
    // plain digits are treated as epoch ms.
    if (/^\d{12,}$/.test(s)) return Number(s);
    const t = Date.parse(s);
    if (Number.isNaN(t)) fail(`invalid --since value: ${s} (use 30s, 5m, 2h, 1d or an ISO date)`, 2);
    return t;
};

// print help text to stdout.
export const printHelp = lines => {
    console.log(lines.join('\n'));
};

// print an error to stderr and exit with the code (default 1).
export const fail = (msg, code = 1) => {
    console.error(`ERROR: ${msg}`);
    process.exit(code);
};
