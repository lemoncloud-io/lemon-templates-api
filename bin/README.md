# bin/ — invoke the deployed Lambda and watch its logs

Two small Node scripts for test-env and prod verification after `sls deploy`.
They call AWS directly with the SDK (no `sls`), so they work on any machine with AWS credentials.

- `lambda-invoke.mjs` — invoke the deployed function with a generated event (web, cron, SNS, SQS, or a raw JSON file).
- `lambda-logs.mjs` — print or follow the function's CloudWatch logs (polling `FilterLogEvents`).

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
| `--stage <stage>` | `dev` | Deploy stage. |
| `--function`, `--fn <fn>` | `lambda` | `lambda` or `backend`. |
| `--name <name>` | | Full function name. Overrides `<service>-<stage>-<fn>`. |
| `--region <region>` | `AWS_REGION` or `ap-northeast-2` | AWS region. |
| `--profile <name>` | SDK default chain | Named profile. |
| `--event <kind>` | `web` | `web`, `cron`, `sns`, `sqs`, or `raw`. |
| `--method <METHOD>` | `GET` | HTTP method (web). |
| `--path <path>` | `/` | HTTP path (web). A `?a=1` part goes into the query. |
| `--query k=v` | | Query parameter (web). Repeatable. |
| `--header k:v` | | Header (web). Repeatable. |
| `--body <json>` or `--body @file.json` | | Body (web), SNS `Message`, or SQS `body`. SNS/SQS default to `{}`. |
| `--subject <text>` | `lambda-invoke` | SNS `Subject`. |
| `--cron-name <name>` | `1MIN` | `cron.name` (cron). |
| `--file <event.json>` or `--file -` | | Event JSON (raw). `-` reads stdin. |
| `--dry` | | Print the target and the event JSON. Do not call AWS. |
| `--tail` | | Request the log tail (last 4 KB) and print it after the response. |
| `--async` | | `InvocationType=Event`. No payload comes back. |
| `--json` | | Print the raw response payload only. |
| `--help` | | Show help. |

Web events are API Gateway REST (v1) proxy events.
`resource` and `pathParameters` follow the `/{type}/{id}/{cmd}` routes of `serverless.yml`:
`/hello/0` becomes `resource=/hello/{id}`, `pathParameters={ id: '0' }`.
Default headers are `Host: localhost`, `Accept: application/json`, `User-Agent: lambda-invoke`, and `Content-Type: application/json` when a body is given.
The `Host` header makes the call look like an external API Gateway request.
`--header` overrides any default.

Examples:

```sh
# web GET /hello/0 with the log tail
npm run lambda:invoke -- --stage dev --profile lemon --path /hello/0 --tail

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

Output: a header line `invoke <name> event=<kind> [<METHOD> <path>]`, then `status=<StatusCode> function-error=<FunctionError|none> took=<ms>ms`.
For web events with a `statusCode` in the payload, it prints `http <statusCode>` and the body (pretty JSON when it parses).
For other events it prints the payload.
With `--tail`, the decoded log follows a `--- log tail ---` line.

## lambda:logs

```sh
npm run lambda:logs -- [options]
```

| Option | Default | Meaning |
|---|---|---|
| `--stage`, `--function`/`--fn`, `--name`, `--region`, `--profile` | | Same as `lambda:invoke`. |
| `--group <log-group>` | `/aws/lambda/<name>` | Log group override. |
| `--since <t>` | `5m` | `30s`, `5m`, `2h`, `1d`, or an ISO date. |
| `--follow`, `-f` | | Keep polling until Ctrl-C. |
| `--interval <sec>` | `2` | Poll interval with `--follow`. |
| `--filter <pattern>` | | CloudWatch filter pattern (server side). |
| `--grep <regex>` | | Case-insensitive regex on the message (client side). |
| `--perf` | | Shortcut for `--grep 'PERF:'`. |
| `--json` | | One JSON object per line: `{ ts, stream, message }`. |
| `--help` | | Show help. |

Each line is `YYYY-MM-DD HH:mm:ss.SSS  <last 8 chars of the stream>  <message>` in local time.
A header line `logs <group> since=<iso> follow=<bool>` goes to stderr.
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
npm run lambda:logs -- --stage prod --profile lemon --since 2026-10-28T09:00:00+09:00 --json
```

## Exit codes

| Code | `lambda:invoke` | `lambda:logs` |
|---|---|---|
| 0 | `StatusCode` 2xx and no `FunctionError` (also `--dry`, `--help`) | OK (also Ctrl-C in follow mode) |
| 1 | Non-2xx `StatusCode`, a `FunctionError`, or an AWS error | AWS error |
| 2 | Bad arguments | Bad arguments, or the log group does not exist |

`lambda:invoke` exit codes reflect the Lambda call only. An `http 4xx/5xx` from the web handler still exits 0; check the printed `http` line.
