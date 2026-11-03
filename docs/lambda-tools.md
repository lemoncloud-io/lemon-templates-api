# Lambda tools (`lemon-*` commands of lemon-core)

Since lemon-core 5.0.13 (v5 B19) the Lambda tools that were in this repository's `bin/` ship with lemon-core as npm bins.
This service runs them through the same `npm run` scripts, so the commands in [README.md](../README.md) are unchanged.
`npm run <script> -- --help` prints the usage of each tool.

Options, output, credentials, safety rules (strict options, stage guard, identity line, redaction, size cap) and exit codes are documented once, in lemon-core:

-   `HOW_TO_UPGRADE_V5.md` § 19 — script mapping and optional peers.
-   `docs/v5/B19-bin-tools.md` — `lemon-lambda-invoke`, `lemon-lambda-logs`, `lemon-lambda-perf`, `lemon-fields-admin`, `lemon-loop-check`.
-   `docs/v5/B19-bin-deploy.md` — `lemon-lambda-pack`, `lemon-lambda-local`, `lemon-lambda-deploy`, `lemon-lambda-deploy-dev`, `lemon-lambda-migrate`.

This page keeps only what is specific to this service. The tests of the tools are in lemon-core (`npm test` there); this repository has no `lambda:test` / `pack:test` scripts any more.

## Scripts

| Script              | lemon-core bin            | Does                                                                                | Service notes                                                |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pack`              | `lemon-lambda-pack`       | Build a verified Lambda ZIP + `manifest.json` in Docker. No AWS credentials.        | [lambda-pack.md](lambda-pack.md), adapter `pack.config.json` |
| `lambda:local`      | `lemon-lambda-local`      | Run a pack result or a compiled handler folder in local Node child processes.       | [lambda-local.md](lambda-local.md)                           |
| `lambda:deploy`     | `lemon-lambda-deploy`     | Offline deployment plan; `--apply` deploys through the deploy service.              | [lambda-deploy.md](lambda-deploy.md)                         |
| `lambda:deploy:dev` | `lemon-lambda-deploy-dev` | Guarded code-only release of this service's `dev` target.                           | [lambda-migrate.md](lambda-migrate.md)                       |
| `lambda:migrate`    | `lemon-lambda-migrate`    | One guarded phase of this service's `dev` stack migration; offline plan by default. | [lambda-migrate.md](lambda-migrate.md)                       |
| `lambda:invoke`     | `lemon-lambda-invoke`     | Invoke the deployed function with a generated event.                                |                                                              |
| `lambda:logs`       | `lemon-lambda-logs`       | Print or follow the function's CloudWatch logs.                                     |                                                              |
| `perf:lambda`       | `lemon-lambda-perf`       | Invoke several times and summarize cold / warm timings.                             |                                                              |
| `fields:admin`      | `lemon-fields-admin`      | Check `GET /<type>/fields/admin` on the local server or the deployed Lambda.        | [fields:admin](#fieldsadmin)                                 |
| `loop:check`        | `lemon-loop-check`        | Check the SNS / SQS / protocol / notify / enqueue loop test.                        | [loop:check](#loopcheck)                                     |
| `deploy:dev`        | `bin/deploy-dev.sh`       | Manual dev deploy: pack → plan → `--apply` → probe, in one command. Human-run only. | [Manual dev deploy](#manual-dev-deploy-bindeploy-devsh)      |

`lemon-lambda-migrate` and `lemon-lambda-deploy-dev` pin their target to this service (`lemon-templates-api`, stage `dev`); the pin lives in lemon-core, not here.

### Manual dev deploy (`bin/deploy-dev.sh`)

`npm run deploy:dev` is the one-command path for a human to ship the current checkout to the `lemon` dev stage. It wraps the same tools as the rows above and runs them in the lane order — nothing in it is new deploy logic.

1. Preflight: `package.json` + `pack.config.json` present, stage `dev` only (prod stays a Serverless stack, see [serverless.md](serverless.md)), Node ≥ 24, `jq`, `aws`, `docker`, lemon-core bins installed, config in **code mode** with matching `stage` / `profile` / `project` (`project` = `package.json` `name`), `aws sts get-caller-identity` (account redacted).
2. Pack: `npm run pack -- --output .artifacts/lambda/dev-<time>-<sha>` (Docker). `--skip-pack --artifact <dir>` reuses an existing pack.
3. Offline plan: `lambda:deploy --config … --artifact …` → `<artifact>/plan.dev.json`, summary printed with account / endpoint redacted. `--plan-only` stops here.
4. Apply: a **separate** `lambda:deploy … --apply --receipt-dir .artifacts/deploy/receipts` command; the run must end `completed`. No prompt by default — `--ask` inserts a confirm step.
5. Probe: `lambda:invoke --path /` and `/hello/0`.

Config: `.artifacts/deploy.code.dev.json` (git-ignored). When it is missing the script fills it once — copies `deploy.code.dev.json` from the private lane folder `../.wt/v5-private/<service>/` next to the main checkout (override with `DEPLOY_PRIVATE_DIR`), else reduces that folder's `deploy.dev.json` to code mode with `jq`, else writes the example and stops so the real values can be filled in. The file holds account / endpoint / bucket values and is never committed.

Difference from `lambda:deploy:dev`: that bin is lemon-core's guarded registry release (target pinned in lemon-core). `deploy:dev` is this repository's own wrapper around pack + plan + apply + probe and reads the local config instead.

```bash
npm run deploy:dev                                   # pack → plan → apply → probe
npm run deploy:dev -- --plan-only                    # pack + plan, no AWS change
npm run deploy:dev -- --skip-pack --artifact .artifacts/lambda/dev-20261103-1200-abc1234
npm run deploy:dev -- --ask                          # confirm before --apply
```

## What the tools read in this repository

The tools run from the service root (`process.cwd()`; npm runs a script from the package root). The invoke / observe tools also take `--cwd <dir>`.

-   `serverless.yml`: only the top-level `service:` line. The function name is `<service>-<stage>-<fn>` and the log group `/aws/lambda/<name>`.
-   `package.json`: only `"port"` (8800), the default port of the `express` targets of `fields:admin` and `loop:check`.
-   `src/modules/mock/fields-admin.expected.json`: the default `--expect` of `fields:admin --type mocks`.
-   `pack.config.json` for `pack`; the deploy and migration configs that you pass with `--config` (keep real ones in the Git-ignored `.artifacts/`).

Nothing reads `env/*.yml`, `env/config.js`, or the `custom:` / `environment:` blocks of `serverless.yml`.

lemon-core is a runtime dependency, so its `bin/` files are part of `node_modules/lemon-core` inside the Lambda ZIP. They are never loaded by `handler.js`.

## AWS SDK packages

The AWS SDK packages are optional peers of lemon-core. `--help`, `--dry` and the `express` targets need none of them; a call that needs a missing one stops with an `npm i -D <package>` hint.

| Package                           | Declared here in  | Needed by                                                                                             |
| --------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `@aws-sdk/client-lambda`          | `dependencies`    | `lambda:invoke`, `perf:lambda`, `fields:admin --target lambda`, `loop:check`, `lambda:deploy --apply` |
| `@aws-sdk/client-sts`             | `dependencies`    | the identity line of the invoke / observe tools                                                       |
| `@aws-sdk/credential-providers`   | `dependencies`    | `--profile <name>`, `lambda:deploy --apply`                                                           |
| `@aws-sdk/client-cloudwatch-logs` | `devDependencies` | `lambda:logs`, `perf:lambda --logs`, `loop:check`                                                     |

## fields:admin

lemon-core v5 serves `GET /<type>/fields/admin` on every CRUD controller. The route is open only on a local server (`LOCAL_MODE=1`) or on a direct `lambda:Invoke` (no `Host`).

`lemon-fields-admin` checks the report with `checkFieldsAdmin()` of lemon-core (loaded from lemon-core `dist/`).
The jest spec `src/modules/mock/fields-admin.spec.ts` imports the same `checkFieldsAdmin()` from `lemon-core` and uses the same fixture (`src/modules/mock/fields-admin.expected.json`).
So jest, the local express server, and the deployed Lambda run the same check.
When the model fields of `mocks` change, update `counts` and `extra` of that fixture.

```sh
# local server (LOCAL_MODE=1) on the package.json port
npm run fields:admin -- --target express

# deployed dev Lambda: admin check + gate check (403 through API Gateway)
npm run fields:admin -- --target lambda --stage dev --profile <name>

# show both events first, no AWS call
npm run fields:admin -- --target lambda --stage dev --dry
```

## loop:check

The loop test proves that a message really goes around the deployed service.
An admin request to the `lambda` function sends one message. The receiver writes one log line.
The code is in the callback module: `src/modules/callback/loop.ts` and `src/modules/callback/api-callback.ts`.

| Kind       | Trigger (function `lambda`)    | Path of the message                                                                                                                       | Receiver                                                                                                         | `[LOOP] recv` line in |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| `sns`      | `POST /callback/sns/loop`      | `sns.publish('', 'x-loop-test', payload)` to the topic of env `MY_SNS_ENDPOINT`                                                           | function `backend` → lemon-core `LambdaSNSHandler` → `onLoopMessage()`                                           | `backend` log group   |
| `sqs`      | `POST /callback/sqs/loop`      | `sqs.sendMessage(payload, { Subject: 'x-loop-test', loop, loopId })` to the queue of env `MY_SQS_ENDPOINT`                                | function `backend` → lemon-core `LambdaSQSHandler` → `onLoopMessage()`                                           | `backend` log group   |
| `protocol` | `POST /callback/protocol/loop` | `$protocol(context, '//self/callback/<loopId>/loop-recv').execute(null, payload, 'POST')` (signed; `//self` is the `lambda` function)     | `POST /callback/<loopId>/loop-recv` → `onLoopRecv()`                                                             | `lambda` log group    |
| `notify`   | `POST /callback/notify/loop`   | `$protocol(…).notify(null, payload, 'POST')` → SNS, Subject `x-protocol-service` (signed), no callback                                    | function `backend` → `LambdaSNSHandler` protocol path → `handleProtocol()` → `POST /callback/<loopId>/loop-recv` | `backend` log group   |
| `enqueue`  | `POST /callback/enqueue/loop`  | `$protocol(…).enqueue(null, payload, 'POST', undefined, 0)` → SQS, attribute Subject `x-protocol-service` (signed), no callback, no delay | function `backend` → `LambdaSQSHandler` protocol path → `handleProtocol()` → `POST /callback/<loopId>/loop-recv` | `backend` log group   |

`$protocol()` gets `{ isProd: false }`, so `//self` stays on the deployed stage.
Without it, the helper switches to stage `prod` when env `NS` is `SS`.

For `notify` and `enqueue`, lemon-core builds the target from the service name and the stage (`buildProtocolURI`).
For this service it gives `sns://<code>-sns[-dev]` and `sqs://<code>-sqs[-dev]`.
These are `custom.topicName` and `custom.queueName` of `serverless.yml`: the topic and the queue that `backend` subscribes to.
The SNS / SQS transformers take the region and the account from `getHelloArn()` (env `REPORT_ERROR_ARN`) and put this topic or queue name in its place.
The jest spec checks this mapping against `serverless.yml` for `dev` and `prod`.

The payload is `{ loop, loopId, sentAt, hop: 1 }` (+ `note`, max 100 chars, from the request body).
The trigger answers `{ kind, loopId, messageId, sentAt }` (`sns`, `sqs`, `notify`, `enqueue`) or `{ kind, loopId, sentAt, result }` (`protocol`; `result` is `{ loopId, recvAt, hop }` from the receiver).
No ARN, queue URL, or function name is in a response or in a `[LOOP]` line.

Log lines (lemon-core `_inf`):

```text
[LOOP] send kind=<sns|sqs|protocol|notify|enqueue> loop=<loopId> message=<messageId|-> tid=<tid> hop=0
[LOOP] recv kind=<sns|sqs> loop=<loopId> latency=<ms>ms
[LOOP] recv kind=<protocol|notify|enqueue> loop=<loopId> latency=<ms>ms tid=<tid> hop=1
[LOOP] done kind=protocol loop=<loopId> rtt=<ms>ms tid=<tid> hop=0
[LOOP] bad kind=<kind> [loop=<loopId>] reason=<loopId|sentAt|hop|loop|error>
```

`latency` is the receiver's `Date.now() - sentAt` (the clocks of two Lambda containers). `rtt` is the round trip of the `protocol` call, seen by the trigger.

`tid` and `hop` come from lemon-core's call trace (B14, `context.trace`).
The trigger request is the first entry: `tid` is its request id, `hop` is 0.
`protocol`, `notify`, and `enqueue` cross one protocol hop. lemon-core sends the relay (`x-lemon-relay` on web, the `relay` field on SNS / SQS): the identity summary and the trace only, no full context.
So their recv line has the same `tid` and `hop=1`. lemon-core also writes one `TRACE tid=<tid> hop=<hop> ch=<channel> …` line per entry.
`sns` and `sqs` send a raw message (no relay), and the listener gets no context: their recv line has no `tid`.
A `tid` with whitespace is written with `_`.

### Infinite-loop guards

루프 테스트 수신부는 로그만 남긴다. 재발신하지 않는다.

1. The receivers (SNS listener, SQS listener, protocol `loop-recv` for `protocol` / `notify` / `enqueue`) only log and return. They never publish, send, enqueue, notify, or execute.
2. The trigger refuses re-entry through the protocol channel: `400 INVALID LOOP - nested trigger`. A relay hop has `context.trace.hop > 0` (lemon-core counts it; web, SNS, and SQS). A legacy `x-protocol-context` call (a v4 caller) arrives with hop 0 and the caller's `context.source`, so a `source` path of another route is refused too. `context.depth` is not read: the trigger does not raise it, and the relay does not carry it.
3. Hop cap: a receiver accepts only `hop === 1`. Any other value (missing, `2`, `'1'`) logs `[LOOP] bad … reason=hop` and returns `''`. Nothing increments `hop` and forwards.
4. The SNS / SQS listener never throws. `loop-recv` never throws when it came through the protocol channel (`trace.hop > 0` and `channel` not `external`). A throw on an SQS path is a `batchItemFailures` redelivery; on an SNS path lemon-core reports the error. Any error logs `[LOOP] bad … reason=error` and returns `''`. Only a direct non-admin call to `loop-recv` still gets its 403.
5. lemon-core error reports go to the `REPORT_ERROR_ARN` topic with the subject `error`. That topic is not the one `backend` subscribes to, and the listener acts only on the subject `x-loop-test`.
6. No cron, no schedule, no retry loop in app code. `loop:check` sends exactly one invoke per kind and polls the logs with a hard timeout. It never retries an invoke.
7. `notify` and `enqueue` never pass a callback. With a callback, the receiving handler would call one more target after `loop-recv`.

Limit — a failed signature: in `PROTOCOL_VERIFY=enforce` mode, lemon-core checks the signature of a protocol message before it calls our handler.
A bad signature on the SNS path is reported and dropped (the v5 SNS handler does not rethrow).
On the SQS path the record goes to `batchItemFailures`, and SQS delivers it again after each `VisibilityTimeout`.
The queue in `serverless.yml` (`MyQueue`) has no redrive policy and no dead-letter queue.
So a failing message comes back every 300 s (`VisibilityTimeout`) until `MessageRetentionPeriod` (1800 s) ends: about 6 receives, each with an error report.
The queue also has `MaximumMessageSize: 4096`; an `enqueue` message carries the protocol param (the relay, about 0.4 KB, and the body). With `PROTOCOL_LEGACY_CONTEXT=send` it carries the full context too, so a large context can be refused.

The jest spec `src/modules/callback/api-callback-loop.spec.ts` covers each guard.

### Access

-   The trigger is admin only: `403 NOT ALLOWED - only for admin @doPostLoop(callback/<kind>)` otherwise. lemon-core `hasAdminRole()` is true in local mode (`LOCAL_MODE=1`), for a signed access key, for an authed `admin` role, or when `context.identity.roles` has `admin`.
-   `loop:check` sends an internal web event (no `Host`, like `lambda:invoke --internal`) with `x-lemon-identity: {"sid":"loop-check","roles":["admin"]}` (like `--identity`). lemon-core drops a JSON identity without a non-empty `sid`, so the trigger then answers 403.
-   An unknown kind answers `404 NOT FOUND - callback/<kind>/loop`.
-   `loop-recv` takes a protocol call (`trace.hop > 0` and `channel` not `external`: `protocol`, `notify`, `enqueue`) or an admin. Any other non-admin request (external, direct invoke, local) answers 403.
-   Limit: lemon-core verifies the signature of a host-less identity. In `PROTOCOL_VERIFY=enforce` mode the unsigned `x-lemon-identity` of `loop:check` answers 403 (the run exits 1). In `warn` mode it passes with one `PROTOCOL unsigned web` log line.

### Manual equivalent

```sh
# 1. trigger (prints the loopId in the http body)
npm run lambda:invoke -- --stage dev --internal --identity '{"sid":"loop-check","roles":["admin"]}' --method POST --path /callback/sns/loop

# 2. the recv line of that loop (sns, sqs, notify, enqueue: --fn backend; protocol: --fn lambda)
npm run lambda:logs -- --stage dev --fn backend --since 5m --filter '"<loopId>"'

# 3. every line of that call chain by the tid of the send line ([LOOP] and lemon-core TRACE; also --fn lambda)
npm run lambda:logs -- --stage dev --fn backend --since 5m --filter '"tid=<tid>"'
```

Examples:

```sh
# all five loops on dev
npm run loop:check -- --stage dev --profile <name>

# one kind, longer wait, machine-readable
npm run loop:check -- --stage dev --kind sqs --timeout 120000 --json

# show the targets and the events first, no AWS call
npm run loop:check -- --stage dev --dry
```

### `--target express` (local)

The same five loops on a local server, with no AWS.
Start the server with `npm run express.lemon` (`LOCAL_MODE=1` from the env file, and `LOCAL_TRANSPORT=mock`).
lemon-core's local transport then delivers each send to this service in the same process: it builds the Lambda record and runs it through the engine's `LambdaHandler.handle()`.
A target that is not this service answers `501 NOT SUPPORTED - local transport: <name> is not this service`.

Per kind, `loop:check` sends one `POST http://127.0.0.1:<port>/callback/<kind>/loop` (body `{"note":"loop:check"}`; local mode makes it admin).
The route waits for the delivery (`$localTransport.drain()`), then answers `{ …, mock: true, recv: [{ kind, loopId, recvAt, hop }] }`.
The kind passes with http 200, `mock: true`, and exactly one `recv` with the same `loopId`. `latency` is `recv[0].recvAt - sentAt`.
There is no STS call and no log poll. `--json` prints `{ target: 'express', url, results }`.

```sh
npm run express.lemon                                        # terminal 1
npm run loop:check -- --target express                       # terminal 2: 5 lines send=ok recv=ok, exit 0
npm run loop:check -- --target express --port 8899 --kind notify --json
```

The server log has one `[MOCK] deliver kind=<sns|sqs|protocol> target=<name> message=mock-<uuid>` line and one `[LOOP] recv` line per kind; the send lines end with ` mock=1`.
`npm run express.lemon.aws` starts the server without the local transport (the sends go to AWS); `loop:check --target express` then reports `no mock: true in the response`.
Exit codes: 0 = every kind passed; 1 = any issue, or the server is not reachable (`ERROR: cannot reach <url> (ECONNREFUSED)`); 2 = bad arguments.
