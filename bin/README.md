# bin/ — invoke the deployed Lambda, watch its logs, and check `fields/admin`

Small Node scripts for test-env and prod verification after `sls deploy`.
They call AWS directly with the SDK (no `sls`), so they work on any machine with AWS credentials.

- `lambda-invoke.mjs` — invoke the deployed function with a generated event (web, cron, SNS, SQS, or a raw JSON file).
- `lambda-logs.mjs` — print or follow the function's CloudWatch logs (polling `FilterLogEvents`).
- `fields-admin.mjs` — check `GET /<type>/fields/admin` on the local express server or the deployed Lambda with `checkFieldsAdmin()` of lemon-core. See [fields:admin](#fieldsadmin).

The Lambda call itself (`lambda:Invoke`) is shared in `lib/invoke.mjs` by `lambda-invoke.mjs` and `fields-admin.mjs`.

The target function name is `<service>-<stage>-<function>` (Serverless default).
`service` is read from the `service:` line of `serverless.yml`.
The log group is `/aws/lambda/<function name>`.

Nothing here reads `env/*.yml`, `env/config.js`, or the `custom:` / `environment:` blocks of `serverless.yml`.
`bin/` is not packaged into the Lambda zip (`package.include` lists only `handler.js`, `package.json`, `dist/**`, `data/**`).

## Credentials

- `--profile <name>` uses that named profile from `~/.aws`.
- Without `--profile`, the AWS SDK default chain applies: `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, SSO, instance role.
- Region: `--region`, else `AWS_REGION`, else `ap-northeast-2`.

## lambda:invoke

```sh
npm run lambda:invoke -- [options]
```

| Option | Default | Meaning |
|---|---|---|
| `--stage <stage>` | `dev` | Deploy stage. Any stage other than `dev` needs `--confirm-stage`. |
| `--confirm-stage <stage>` | | The same value as the stage. Required for any stage other than `dev`. See [Safety](#safety). |
| `--function`, `--fn <fn>` | `lambda` | `lambda` or `backend`. |
| `--name <name>` | | Full function name. Overrides `<service>-<stage>-<fn>`. Goes through the stage guard. |
| `--region <region>` | `AWS_REGION` or `ap-northeast-2` | AWS region. |
| `--profile <name>` | SDK default chain | Named profile. |
| `--event <kind>` | `web` | `web`, `cron`, `sns`, `sqs`, or `raw`. |
| `--method <METHOD>` | `GET` | HTTP method (web). |
| `--path <path>` | `/` | HTTP path (web). A `?a=1` part goes into the query. |
| `--query k=v` | | Query parameter (web). Repeatable. |
| `--header k:v` | | Header (web). Repeatable. |
| `--internal` | | Web only. Send no `Host` header (removed from `headers` and `multiValueHeaders`, also one given by `--header`) and no `requestContext.domainName`, like a direct `lambda:Invoke`. lemon-core then treats the call as internal. The banner shows `event=web(internal)`. With any other `--event`: exit 2. |
| `--identity <json>` | | Web only. Sets the `x-lemon-identity` header to the JSON text as given (wins over `--header x-lemon-identity:…`). lemon-core reads it on internal calls only, so without `--internal` a warning goes to stderr. Invalid JSON or another `--event`: exit 2. `--dry` prints it as `<redacted>`. |
| `--body <json>` or `--body @file.json` | | Body (web), SNS `Message`, or SQS `body`. SNS/SQS default to `{}`. |
| `--subject <text>` | `lambda-invoke` | SNS `Subject`. |
| `--cron-name <name>` | `1MIN` | `cron.name` (cron). |
| `--file <event.json>` or `--file -` | | Event JSON (raw). `-` reads stdin. |
| `--dry` | | Print the target and the event JSON. Do not call AWS (no STS call either). Sensitive header values print as `<redacted>`. |
| `--tail` | | Request the log tail (last 4 KB) and print it after the response. |
| `--async` | | `InvocationType=Event`. No payload comes back. |
| `--json` | | Print the raw response payload only. String values are redacted; the JSON structure is kept. |
| `--raw` | | Do not redact the output. Control stripping and the size cap stay. |
| `--max-bytes <n>` | `65536` | Cap for one printed body or log tail. `0` means no cap. |
| `--help` | | Show help. |

Web events are API Gateway REST (v1) proxy events.
`resource` and `pathParameters` follow the `/{type}/{id}/{cmd}` routes of `serverless.yml`:
`/hello/0` becomes `resource=/hello/{id}`, `pathParameters={ id: '0' }`.
Default headers are `Host: localhost`, `Accept: application/json`, `User-Agent: lambda-invoke`, and `Content-Type: application/json` when a body is given.
The `Host` header makes the call look like an external API Gateway request; `--internal` removes it.
`--header` overrides any default.

Examples:

```sh
# web GET /hello/0 with the log tail
npm run lambda:invoke -- --stage dev --profile lemon --path /hello/0 --tail

# internal web call (no Host header), e.g. the lemon-core admin command `GET /<type>/fields/admin`
npm run lambda:invoke -- --stage dev --internal --path /mocks/fields/admin

# web POST with a JSON body, a query and a header
npm run lambda:invoke -- --stage dev --profile lemon --method POST --path /hello/0 --body '{"x":1}' --query a=1 --header x-test:1

# cron (same input as the 1-minute schedule)
npm run lambda:invoke -- --stage dev --profile lemon --event cron

# SNS record into the backend function
npm run lambda:invoke -- --stage dev --profile lemon --fn backend --event sns --body '{"a":1}'

# SQS record into the backend function, body from a file
npm run lambda:invoke -- --stage dev --profile lemon --fn backend --event sqs --body @message.json

# any event from a file (check it first with --dry)
npm run lambda:invoke -- --stage dev --profile lemon --event raw --file event.json --dry
```

Before the call, one identity line goes to stderr (see [Safety](#safety)).
Output: a header line `invoke <name> event=<kind> [<METHOD> <path>]` (`event=web(internal)` with `--internal`), then `status=<StatusCode> function-error=<FunctionError|none> took=<ms>ms`.
For web events with a `statusCode` in the payload, it prints `http <statusCode>` and the body (pretty JSON when it parses).
For other events it prints the payload.
With `--tail`, the decoded log follows a `--- log tail ---` line.
Everything printed from AWS is redacted and capped (see [Safety](#safety)).

## lambda:logs

```sh
npm run lambda:logs -- [options]
```

| Option | Default | Meaning |
|---|---|---|
| `--stage`, `--confirm-stage`, `--function`/`--fn`, `--name`, `--region`, `--profile` | | Same as `lambda:invoke`. |
| `--group <log-group>` | `/aws/lambda/<name>` | Log group override. Goes through the stage guard by the function name in `/aws/lambda/<name>`. |
| `--since <t>` | `5m` | `30s`, `5m`, `2h`, `1d`, or an ISO date. |
| `--follow`, `-f` | | Keep polling until Ctrl-C. |
| `--interval <sec>` | `2` | Poll interval with `--follow`. |
| `--filter <pattern>` | | CloudWatch filter pattern (server side). |
| `--grep <regex>` | | Case-insensitive regex on the message (client side). |
| `--perf` | | Shortcut for `--grep 'PERF:'`. |
| `--json` | | One JSON object per line: `{ ts, stream, message }`. |
| `--raw` | | Do not redact messages. Control stripping and the size cap stay. |
| `--max-bytes <n>` | `65536` | Cap for one message. `0` means no cap. |
| `--help` | | Show help. |

Each line is `YYYY-MM-DD HH:mm:ss.SSS  <last 8 chars of the stream>  <message>` in local time.
The identity line and a header line `logs <group> since=<iso> follow=<bool>` go to stderr.
Each message is control-stripped, redacted, and capped (see [Safety](#safety)).
In follow mode each poll re-scans the last 10 seconds and skips event ids it has already printed, so late events from other streams are not lost.

Examples:

```sh
# last 30 minutes
npm run lambda:logs -- --stage dev --profile lemon --since 30m

# follow, PERF lines only
npm run lambda:logs -- --stage dev --profile lemon --follow --perf

# server-side filter on the backend function
npm run lambda:logs -- --stage dev --profile lemon --fn backend --since 1h --filter '"ERROR"'

# machine-readable, since a fixed time
npm run lambda:logs -- --stage prod --confirm-stage prod --profile lemon --since 2026-10-28T09:00:00+09:00 --json
```

## fields:admin

```sh
npm run fields:admin -- --target express|lambda [options]
```

lemon-core v5 serves `GET /<type>/fields/admin` on every CRUD controller.
It returns a report of the model fields: `type`, `model`, `core`, `fields`, `extra`, `counts`, `source`, `ok`, `issues`, and `runtime` (`local`, `external`, `lambda`, `node`, `lemonCore`).
The route is open only on a local server (`LOCAL_MODE=1`, not in Lambda) or on a direct `lambda:Invoke` (a request with no `Host`).
Any other request gets `403 NOT ALLOWED - fields/admin is local or direct-invoke only @doGetAdmin(<type>/fields)`.

This script checks that report with `checkFieldsAdmin()` of lemon-core, the one verifier of the report.
The jest spec `src/modules/mock/fields-admin.spec.ts` uses the same verifier and the same fixture (`src/modules/mock/fields-admin.expected.json`).
So jest, the local express server, and the deployed Lambda all run the same check.

| Option | Default | Meaning |
|---|---|---|
| `--target <t>` | | Required. `express` or `lambda`. |
| `--type <type>` | `mocks` | API type (one path segment). |
| `--expect <file>` | the fixture for `mocks` | Expected values (JSON object with any of `type`, `model`, `source`, `counts`, `extra`, `core`, `lemonCore`). For another type without `--expect`, only the structural and content checks run. A missing file, invalid JSON, or an unknown key: exit 2. |
| `--json` | | Print `{ target, type, status, report, check: { ok, issues }, gate }` only. String values are redacted; the structure is kept. |
| `--raw`, `--max-bytes <n>` | | Same as `lambda:invoke`. |
| `--help` | | Show help. |
| `--url <base>` | `http://127.0.0.1:<"port" of package.json>` | `express` only. Server base URL. |
| `--stage`, `--confirm-stage`, `--function`/`--fn`, `--name`, `--region`, `--profile` | | `lambda` only. Same as `lambda:invoke`, with the same stage guard and identity line. |
| `--dry` | | `lambda` only. Print the target and both events (sensitive headers masked). No AWS call, no STS call. |
| `--no-gate` | | `lambda` only. Skip the gate check. |

An option of the other target is an error (exit 2), for example `--stage` with `--target express`.

### Targets

- `express`: `GET <base>/<type>/fields/admin` with `Accept: application/json`.
  It expects HTTP 200, then runs `checkFieldsAdmin(report, { ...expect, runtime: { local: true, lambda: false } })`.
- `lambda`: two direct invokes of the deployed function.
  1. Admin: an internal web event (no `Host` header, like `lambda:invoke --internal`) for `/<type>/fields/admin`.
     It expects `statusCode` 200 in the payload, then runs `checkFieldsAdmin(report, { ...expect, runtime: { local: false, external: false, lambda: <function name> } })`.
  2. Gate: the default external web event (with `Host`, like an API Gateway request) for the same path.
     It expects `statusCode` 403 (`gate=closed(403)`). Any other code is a failure (`gate=open(<code>)`). `--no-gate` skips this step.

### Auth model

- `express`: no credentials. The route is open because the server you started locally runs with `LOCAL_MODE=1` (for example `ENV=lemon STAGE=local node dist/index.js` after `npm run build`). The script does not start or stop the server.
- `lambda`: IAM credentials only (`--profile`, or the SDK default chain), and `lambda:InvokeFunction` on the target function. No API Gateway, no session token, no user identity.
- The API Gateway path answers 403 by design. The gate step checks exactly that, with an event of the same shape.

### Output

One summary line, the same for both targets:

```text
fields/admin target=<express|lambda> type=<type> http=<code> ok=<true|false> source=<source> counts=<core>/<fields>/<extra> runtime=<local|lambda:<name>> lemon-core=<version> issues=<n>
```

Then one `  - <issue>` line per issue, then for `lambda` one `gate=closed(403)` or `gate=open(<code>)` line.
A non-200 response is one issue: `expected http 200 got <code>: <body>`.
For `lambda` the identity line goes to stderr first (see [Safety](#safety)).
The output is redacted and capped like the other scripts.

Exit codes: 0 = HTTP 200, `ok`, and the gate closed (or skipped); 1 = any of those failed, or a transport or AWS error; 2 = bad arguments or the stage guard.

Examples:

```sh
# local server (LOCAL_MODE=1) on the package.json port
npm run fields:admin -- --target express

# machine-readable
npm run fields:admin -- --target express --json

# deployed dev Lambda: admin check + gate check
npm run fields:admin -- --target lambda --stage dev --profile <name>

# show both events first, no AWS call
npm run fields:admin -- --target lambda --stage dev --dry

# another type: structural and content checks only, or with your own expectations
npm run fields:admin -- --target express --type tests
npm run fields:admin -- --target express --type tests --expect path/to/tests.expected.json
```

## Safety

All three scripts apply these rules (rules 2, 3, and 6 apply to `fields:admin --target lambda`).

1. **Strict options.** An option that is not in the table above (and not an alias) stops the run: `ERROR: unknown option --foo (see --help)`, exit 2. An extra positional argument stops it the same way (`unknown argument <arg>`). `--help` still works with any other argument.
2. **Stage guard.** Only `dev` (the default) runs without confirmation. Any other stage needs `--confirm-stage <stage>` with the exact same value: `ERROR: stage "prod" needs --confirm-stage prod`, exit 2. A `--confirm-stage` that differs from the stage is also an error. `--name` (and `--group /aws/lambda/<name>` for `lambda:logs`) gives the stage when the name has the shape `<service>-<stage>-<fn>`. If the stage cannot be derived (another service, or another log group), the run needs both `--stage <stage>` and `--confirm-stage <stage>`. The guard runs before `--dry`.
3. **Identity line.** Before any invoke or log fetch, STS `GetCallerIdentity` runs and one line goes to stderr: `account=****<last4> region=<region> credentials=<profile:<name>|env|default-chain> function=<name>`. The account id shows only its last 4 digits. The ARN is never printed. If STS fails, the run prints `ERROR: cannot resolve AWS identity (<error name>)` and exits 1 before Lambda or Logs is called. `--dry` does not call STS.
4. **Redaction (on by default, `--raw` turns it off).** Everything printed from AWS is redacted: the response body, the `--json` payload, the `--tail` log, log lines, and SDK error messages. For JSON, string values are redacted one by one and the structure is kept. The rules run in this order:
   - 12-digit account ids → `<acct>`. `arn:aws…` up to a blank or a quote → `<arn>`.
   - Access key ids `AKIA…` / `ASIA…` → `<aws-key>`.
   - Values of `authorization`, `x-lemon-identity`, `x-api-key`, `cookie`, `set-cookie` (any case; `key: value`, `"key":"value"`, `key=value`) → `<redacted>`. `Bearer <token>` → `Bearer <redacted>`.
   - JWT-looking tokens (`eyJ….….…`) → `<jwt>`.
   - Values of keys whose name contains `secret`, `password`, `passwd`, `token`, `private_key`, `apikey`, `api_key`, or `access_key` (any case) → `<redacted>`.
   - IPv4 addresses → `<ip>`. URLs keep the scheme and host and lose the path and query: `https://host/<path>`. Emails → `<email>`.
   The `--tail` log and `lambda:logs` messages are also stripped of ANSI escapes and control characters (tab and newline stay). Stripping is always on, also with `--raw`.
5. **Size cap.** A printed response body, a log tail, or a single log message longer than 64 KB is cut and ends with `…[truncated N bytes]`. With `--json`, each string value is cut instead, so the JSON stays valid. `--raw` does not lift the cap. `--max-bytes <n>` sets it; `--max-bytes 0` removes it.
6. **Header echo.** `--dry` prints `<redacted>` for the values of the sensitive headers in rule 4 (`headers` and `multiValueHeaders`). Other headers print as given. The event sent to Lambda keeps the real values. This covers `--identity` (`x-lemon-identity`).
7. **Internal events.** `--internal` only changes the shape of the web event (no `Host` header). It does not bypass the stage guard or the identity line.
8. **Tests.** `npm run lambda:test` runs the offline unit tests in `bin/lib/*.test.mjs` (`node:test`). They cover rules 1, 2, 4, 5, 6, and 7, the identity line format, the web event builder (`--internal`, `--identity`), the shared invoke call, and `fields:admin` with a fake `fetch` and a fake invoker (arguments, both targets, the gate, `--json`, `--no-gate`, `--dry`). They need no AWS access and no server; the scripts run with `--dry` or `--help` only.

## Exit codes

| Code | `lambda:invoke` | `lambda:logs` |
|---|---|---|
| 0 | `StatusCode` 2xx and no `FunctionError` (also `--dry`, `--help`) | OK (also Ctrl-C in follow mode) |
| 1 | Non-2xx `StatusCode`, a `FunctionError`, an AWS error, or no AWS identity (STS) | AWS error, or no AWS identity (STS) |
| 2 | Bad arguments, an unknown option, or the stage guard | Bad arguments, an unknown option, the stage guard, or the log group does not exist |

`lambda:invoke` exit codes reflect the Lambda call only. An `http 4xx/5xx` from the web handler still exits 0; check the printed `http` line.

`fields:admin` exit codes are in its own section: unlike `lambda:invoke`, a non-200 `http` code or a failed check exits 1.
