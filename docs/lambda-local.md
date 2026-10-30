# Local Lambda handler execution

`lambda:local` runs trusted, compiled JavaScript handlers in child Node processes. It can verify and extract a result from [Lambda ZIP packaging](lambda-pack.md), or use a developer's compiled folder. It does not call AWS or deploy anything. Node 24 or newer is required; only Node built-ins are used.

```sh
# Run an existing pack result twice in one process.
npm run lambda:local -- --artifact .artifacts/lambda/release-candidate \
  --event event.json --env-file local-env.json --mode warm --runs 2 --json

# Run the bundled synthetic fixture in separate processes.
npm run lambda:local -- --root bin/fixtures/local \
  --handler-file handler.cjs --handler-export lambda \
  --event bin/fixtures/local/event.json --mode cold --runs 3 --json

npm run lambda:local:test
```

The event file is any JSON value. An environment file is an explicit JSON object of string values, for example `{"LS":"1","STAGE":"dev"}`. Keep local events, environment files, reports and extracted/private source maps out of Git. Logs and result payloads are local, unredacted output and may contain application data.

## Inputs and execution

| Option | Default | Meaning |
| --- | --- | --- |
| `--artifact DIR` | required unless root | Existing pack result containing `manifest.json` and its ZIP. |
| `--root DIR` | required unless artifact | Trusted compiled JavaScript and its installed runtime dependencies. No build/install occurs. |
| `--event FILE` | required | JSON invocation event. Reused for each CLI run. |
| `--mode cold\|warm` | `cold` | Fresh process each run, or sequential reuse of process/module state. |
| `--runs N` | `1` | 1–1000 attempts. |
| `--timeout-ms N` | `3000` | Parent deadline per attempt, including process creation and cold initialization; maximum 900000. |
| `--handler-file FILE` / `--handler-export NAME` | manifest's `validation.handler`, or `handler.js` / `lambda` for root | Supply both options to override. File is relative to the runtime root, with `.js`, `.cjs` or `.mjs` extension. |
| `--env-file FILE` | empty environment additions | Explicit JSON object. `HOME`, `NODE_OPTIONS` and `NODE_PATH` are rejected. |
| `--function-name NAME` | `lambda-local` | Context and Lambda environment identity. |
| `--function-version VERSION` | `$LATEST` | Reported function version. |
| `--function-arn ARN` | synthetic local ARN | Context ARN; defaults to account `000000000000` and supplied `AWS_REGION` or `us-east-1`. |
| `--memory-size MB` | `128` | Context value only; does not allocate or limit memory. |
| `--max-log-bytes N` | `65536` | Independent retained stdout and stderr byte limits per attempt; maximum 16 MiB. |
| `--network deny\|allow` | `deny` | Best-effort standard Node networking guard, or explicitly permitted networking. |
| `--json` | off | Emit the complete schema v1 report. |

Artifact mode checks manifest schema, ZIP size/SHA-256 and the file inventory, then reuses the pack extractor to check each extracted file's bytes/hash. Extraction is in a unique temporary folder and is cleaned up after execution. The harness does not change the original archive or checkout. A hash proves consistency with the supplied manifest, not publisher authenticity. Root mode performs no artifact inventory verification and directly uses the supplied directory. Handler code is trusted and can itself modify accessible files.

CJS and ESM handlers can return JSON values synchronously or through a promise. An `undefined` return is represented as `null`; BigInt, cyclic values and responses above 6 MiB fail serialization. Callback completion and response streaming are unsupported. Calling the supplied callback trap throws `CallbackUnsupportedError`; an unused third parameter does not reject an otherwise valid handler. A callback scheduled after a handler has already returned cannot be treated as a successful callback response.

Every invocation has a fresh `awsRequestId`. Context contains `functionName`, `functionVersion`, `invokedFunctionArn`, `memoryLimitInMB`, `logGroupName`, `logStreamName` and `getRemainingTimeInMillis()`. The remaining time is the parent deadline, so cold initialization consumes its budget. Lambda function/log identity variables and `LAMBDA_TASK_ROOT` are set before importing the handler.

A successful warm request keeps its process and loaded modules. Handler errors, initialization errors, unhandled rejections, uncaught exceptions, process exits and timeouts discard that process. The next attempt is marked cold. Parent termination also stops synchronous infinite loops. On POSIX the runtime has an owned process group, and disposal signals that group to stop descendants that inherited it. Pipe closure is bounded to 250 ms after termination; Windows disposal targets the runtime process only. Scoped SIGINT/SIGTERM and exit handlers stop active groups, while preserving a caller's existing signal policy. An abrupt parent SIGKILL or a deliberately detached descendant is outside this supervision. Runs are sequential; the API does not issue concurrent requests to one worker.

## Environment and host boundary

The child does not inherit the parent environment, including AWS credentials/profiles, `HOME`, `PATH`, `NODE_OPTIONS` or `NODE_PATH`. Only fixed locale/metadata settings, explicit environment entries and synthesized Lambda identity are passed. The child always starts with `--enable-source-maps`, regardless of the parent's Node flags. Explicitly supplied credentials remain application input; avoid supplying them for offline checks.

The default guard patches standard `net`, `tls`, `http`, `https`, DNS, datagram, `fetch` and global WebSocket entry points before the handler is imported. ESM built-in exports are synchronized after patching. This is a development guard for trusted code, not a security sandbox. It does not block filesystem access, subprocesses, native modules or deliberate bypasses. Do not run untrusted archives.

The report identifies the actual host OS, architecture and Node version. An artifact built for Linux/x86_64 can execute pure JavaScript on a different host, and `platformMismatch` records that difference. Native addon ABI compatibility is not verified. IAM, VPC, AWS services, Lambda orchestration, memory/CPU allocation, freeze/thaw and deployment cold-start performance are not emulated. Background work continues between warm invocations; delayed logs can appear in a later attempt's capture window. A future Docker/RIE adapter can reuse the input/report contract while extending OS/ABI and invocation behavior.

## Report contract and timing

The exported adapter is usable by the [bundle lab](lambda-bundle-research.md):

```js
import { runLocal } from './bin/lib/local-runner.mjs';
const report = await runLocal({
  root: '/absolute/compiled-folder',
  handler: { file: 'handler.cjs', export: 'lambda' },
  events: [{ action: 'calculate' }, { action: 'throw' }, { action: 'calculate' }],
  mode: 'warm', timeoutMs: 3000, env: {},
});
```

Use `event` for one repeated value, or `events` for a sequence. `runs` defaults to the sequence length; an explicit count must match it unless there is only one event. Other API options use camelCase names corresponding to the CLI flags. A setup/validation failure rejects before returning a report.

The report has `schemaVersion: 1`, `runner: "node"`, `runId`, `mode`, `network`, `handler`, verified source identity, `host`, `platformMismatch`, timeout/log settings, measurement definitions, limitations and `runs`.

Each attempt has `requestId`, `sessionId`, `processId`, `cold`, `status`, `phase`, `timedOut`, `timings`, `result` or `error`, `stdout`, `stderr`, `exit` and `cleanup`. Status is `success`, `error`, `timeout` or `crash`. Errors carry `name`, `message`, `stack`, optional `code` and fatal-event `kind`. Streams contain `text`, total observed `bytes` and `truncated`. Exit code/signal are null when the process was still running at successful completion; failed attempts include termination state. `cleanup` records disposal `durationMs`, `forcedPipeClose`, process `scope`, and whether runtime exit was observed. It is null on reusable warm attempts; the last attempt of a session receives its disposal record.

- `measurements.setupMs`: artifact validation/extraction or root preparation, performed once outside attempts.
- `timings.initMs`: child boot/import through ready, including a turn of the event loop and log flush. Zero on warm reuse; null when initialization did not complete. Parent process startup is outside this measurement.
- `timings.invokeMs`: handler call, awaited result and JSON conversion. For an interrupted invocation, parent elapsed invocation time is used. This is null for initialization failure.
- `cleanup.durationMs`: session termination and pipe disposal, measured separately from the attempt outcome. A forced pipe close records that descendant or platform behavior prevented ordinary stream closure within 250 ms.
- `timings.totalMs`: parent attempt start through outcome, including child creation/init/IPC; excludes artifact preparation and final process reaping. This is a local measurement, not Lambda billing duration.

An HTTP response with `statusCode: 500` is still a successfully returned function result; callers assess application status separately. CLI exit codes are `0` when all attempts return successfully, `1` when any attempt fails and `2` for invalid input/setup failure.

## Source maps and verification

Native `--enable-source-maps` uses accessible maps linked from compiled files. The fixture test asserts an error restores exactly `original-error.ts:5:1`. Handler dependencies can install their own `Error.prepareStackTrace` hooks, such as `source-map-support`; their behavior belongs to the actual packaged handler and must be checked with that artifact. The option cannot force arbitrary stack hooks to honor maps.

Hidden/private maps outside the runtime folder require offline symbolication. Preserve their build ID and matching code SHA; do not silently attach a map from a different build. `sourcesContent` can expose original code, and maps without it can still expose filenames and symbols. The bundle lab separately verifies composed maps for minified and obfuscated output.

`lambda:local:test` uses real forked children for cold/warm state, JSON returns, context deadlines, environment isolation, synchronous hangs, errors/exits/unhandled rejections, log bounds, ESM networking guards, callback rejection, source-map line recovery and artifact tamper detection. `lambda:test` also includes these tests. Deployment, cloud permissions and application behavior still need their own verification.
