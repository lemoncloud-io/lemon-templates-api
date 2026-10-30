# Templates dev migration and code deployment

`npm run lambda:migrate` prepares and runs one reviewed migration phase for **lemon-templates-api / dev / lemon-templates-api-dev**. Every phase defaults to an offline plan, including `plan` and `verify`. The wrapper executes the existing eureka migration script; it does not copy or reimplement its resource operations. `npm run lambda:deploy:dev` then reuses the verified ZIP deployment CLI for a dev code update.

The initial implementation was verified with synthetic migration fixtures and offline plans, without live backup collection, migration or AWS deployment. A subsequent, separately authorized dev rehearsal is recorded below; it is distinct from the diagnostic patch's synthetic tests.

## Prepare the checkout and explicit config

Use Node 24, Git and an external checkout of `lemoncloud-io/eureka-deploy-api` at **`66d1e91a60a240765d44dedfdab73a92af6abd51`**. Install its locked dependencies separately before execution. Both offline planning and execution verify origin, exact HEAD, a clean tracked tree, and migration/common entry bytes matching their pinned Git blobs even when index flags hide modifications. Entry/import paths and their ancestors may not redirect through symlinks. Ignored private run artifacts are allowed. The wrapper never updates that checkout. AWS CLI v2 and the configured AWS profile are required only for execution. Execution supports macOS/Linux; Windows process-group cleanup is not implemented.

```sh
mkdir -p .artifacts
cp migration.config.example.json .artifacts/migration.dev.json
cp deploy.dev.config.example.json .artifacts/deploy.dev.json
```

Edit account, region, profile, eureka endpoint and the existing installation-managed artifact bucket in both files. Example settings are placeholders and cannot execute. `migrationRepo` resolves relative to the migration config file; the example `../../eureka-deploy-api` assumes a sibling checkout and a config inside this repository's `.artifacts/`. For an isolated worktree, set the correct absolute checkout path. `migrationRevision`, project, stage and stack are fixed by the supported contract.

The wrapper reads neither `env/` nor Serverless environment files. It forces `AGT_BASE/PROFILE/REGION/ACCOUNT` and AWS profile/region from config for the upstream subprocess. Ambient `AGT_*`, static AWS access/session credentials, endpoint overrides, `GIT_*` and Node injection settings are removed. Use a named profile that can resolve independently, such as an SSO or shared-credentials profile; an `Environment` source profile depending on stripped static credentials is not supported. Profile-defined credential helpers and the canonical checkout's installed dependencies remain trusted executable code.

Optional `kmsDecryptKeyArn` and `kmsEncryptKeyArn` must belong to the configured account/region. Do not paste secrets into config, command arguments or Git. The migration snapshot contains the current environment and deployed ZIPs, even though output and receipts omit those values.

Runtime is preserved unless config explicitly includes `"runtime": "nodejs24.x"`. That override is printed in the offline plan and must be reviewed as a runtime change. The later dev code deployment requires both live functions to be Node 24/x86_64 with the packaged handler; preserving an older runtime does not satisfy that preflight. The pinned migration verifier intentionally excludes runtime from its before/after comparison, so this override does not itself block a verified receipt. Review the change consciously and validate runtime compatibility separately.

## Review and execute one phase at a time

```sh
# Offline: validates config and pinned local checkout; no migration/AWS command.
npm run lambda:migrate -- plan --config .artifacts/migration.dev.json
npm run lambda:migrate -- remove --config .artifacts/migration.dev.json
npm run lambda:migrate -- apply --config .artifacts/migration.dev.json
```

The output identifies the target, exact canonical command, effects, runtime override, required consent and phase order. An offline plan does not validate live permissions, resource state or snapshot availability. There is no all-phases command.

| Phase    | Explicit execution command suffix                   | Effect                                                                                                           |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `plan`   | `--execute --allow-sensitive-backup`                | Read live resources, download original deployed ZIPs and save sensitive environment plus before snapshot.        |
| `retain` | `--execute`                                         | Set CloudFormation retain policies for the canonical keep set.                                                   |
| `remove` | `--execute --confirm-stack lemon-templates-api-dev` | Empty the Serverless deployment bucket and remove the stack; retained data/API survive. Downtime starts.         |
| `tag`    | `--execute`                                         | Add eureka management tags to retained resources.                                                                |
| `apply`  | `--execute`                                         | Recreate functions/wiring through eureka using the **old backed-up code**. Upstream apply writes without `--go`. |
| `verify` | `--execute`                                         | Take after snapshot and compare selected identities/settings and HTTP probes.                                    |

For example, only after reviewing and authorizing sensitive backup collection:

```sh
npm run lambda:migrate -- plan --config .artifacts/migration.dev.json --execute --allow-sensitive-backup
```

After reviewing the private snapshot, run subsequent phases separately and inspect each result before proceeding:

```sh
npm run lambda:migrate -- retain --config .artifacts/migration.dev.json --execute
npm run lambda:migrate -- remove --config .artifacts/migration.dev.json --execute --confirm-stack lemon-templates-api-dev
npm run lambda:migrate -- tag --config .artifacts/migration.dev.json --execute
npm run lambda:migrate -- apply --config .artifacts/migration.dev.json --execute
npm run lambda:migrate -- verify --config .artifacts/migration.dev.json --execute
```

The wrapper supplies upstream `--go` only for retain/remove/tag. It requires the exact successful preceding phase and a matching owned config before each invocation. Before any canonical command, an explicit-profile STS `GetCallerIdentity` confirms the configured account. This happens before sensitive backup collection. STS confirms caller account; it does not attest the eureka endpoint's installation.

The profile needs STS identity access plus the direct AWS reads/writes used by the pinned migration source: CloudFormation retain/removal, deployment-bucket cleanup, retained-resource tagging and inspection, deployed Lambda code/config reads, and eureka invocation. Review that source and the installation permissions before execution; the wrapper does not create credentials, permissions or artifact buckets. Later code deployment additionally retains the [deployment preflight permissions](lambda-deploy.md#permissions-and-ownership).

```mermaid
flowchart LR
    P[Offline plan] --> C[Explicit backup consent]
    C --> S[STS account check]
    S --> B[Private old-code and environment snapshot]
    B --> R[Retain]
    R --> D[Confirm stack removal]
    D --> T[Tag retained resources]
    T --> A[Apply old code]
    A --> V[Verify migration]
    V --> Z[Pack reviewed new code]
    Z --> N[Dev ZIP plan]
    N --> U[Explicit dev code apply]
```

## Private state and interrupted operations

State lives in the external canonical checkout at `scripts/migrate/runs/lemon-templates-api-dev/`, with owned directories mode 0700 and regular files mode 0600. Symlinks, hard-linked files, unowned directories and mismatched config fingerprints are rejected. A canonical snapshot created outside this wrapper is not silently adopted.

The owner marker binds the run to normalized config. `templates-receipt.json` records each phase's UTC start/end, monotonic elapsed milliseconds, status, target, protected-file hashes and a validated deployId when emitted. Its SHA-256 envelope detects accidental corruption; it is **not** an authenticated approval or proof against someone with write access to the private directory. Receipt output never contains environment values, old-code bytes, signed URLs or raw upstream errors. Raw child stdout/stderr are not forwarded or persisted. The canonical `dpl_<base36-time>_<six-hex>` identifier is captured from an exact deployId line.

Failed child execution also carries a restricted `diagnostic` object through private IPC to the failed-step receipt and CLI failure JSON. It contains only `kind`, a fixed JavaScript `errorType`, a recognized AWS CLI `awsCode`/`operation` pair, and `sourceFile`/`line`. The source must match the pinned migration or common module; only `migrate.mjs` or `common.mjs` and a line from 1 to 100,000 are retained. AWS CLI headers with or without the exact `aws: [ERROR]: ` prefix are recognized in memory; message text after the header is discarded. Unrecognized values become `other`, with `line: null` when no allowed location exists. Caller boundaries reconstruct the object from fixed vocabularies; arbitrary fields, paths, URLs, messages, arguments and environment values never enter it. A direct nonzero `process.exit` without an exception gets a generic process diagnostic. This identifies a failure category/location, not proof of root cause, and does not change exit codes, state transitions or retry policy.

Before destructive phases, the wrapper rechecks project/stage/stack/bucket/KMS, exactly the two templates dev function identities, before/env consistency and each original ZIP's code SHA. It hashes `plan.json`, `env.json`, `before.json` and original ZIPs; any drift blocks progress. A plan that exits zero with warnings still fails the gate. After verify, `after.json` is included in the protected inventory.

An exclusive lock guards phase progression, with state reloaded after lock acquisition. The in-flight receipt is written before STS and again at the canonical command boundary. SIGINT/SIGTERM cancel the owned subprocess group. If the parent is killed, the child detects IPC disconnection and kills its group; the saved in-flight receipt and lock remain. The default whole-phase deadline is 30 minutes (configurable 1 second to 2 hours), including a maximum 30-second STS preflight. Timing out the local process cannot undo an accepted AWS request.

The pinned upstream apply retries failed tool calls internally up to two times, and some upstream polling loops have no bound. This wrapper adds a phase/process deadline, but does not change that policy or make migration calls exactly-once. This differs from the separate code deployment CLI's no-blind-mutation-retry behavior.

| Result                                      | Exit | Next action                                                                                       |
| ------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------- |
| Offline plan or completed phase             |    0 | Review output; only the next phase is permitted after a completed execution.                      |
| Blocked/known failure                       |    1 | Inspect private state and reconcile before any further phase.                                     |
| Invalid arguments/config or missing consent |    2 | Correct the input; no canonical command has run.                                                  |
| Unknown outcome                             |    3 | A mutation may have completed remotely. Reconcile the server round/resources and private receipt. |

A hard kill may have no final exit report; treat in-flight state as unresolved. There is no automatic retry, rollback, unlock, lease takeover or reset command. Do not delete a lock or rerun apply merely because the process stopped. Use the captured deployId when available; if the identifier was never observed, inspect the server project/stage lease and resource history instead of inventing one or replaying begin.

Warnings may require a KMS/config correction. Changing config changes its fingerprint and cannot reuse the old private backup. After manual review confirms no active child, pending server operation or unresolved lease, preserve/archive the **entire** old private run and plan a new owned run with the corrected config. Keep all original backup evidence private; archiving itself does not authorize repeating destructive steps.

Verification compares environment **keys**, code SHA and selected resource identities/settings, plus the upstream probes. It does not compare decrypted environment values or establish complete runtime/application equivalence. Runtime is intentionally excluded by the pinned verifier: a successful receipt does not establish runtime compatibility, even with an explicit override. Unknown upstream results remain blocked until reconciled.

## Deploy a newly packed dev artifact

Migration apply restores old code first. Once migration verification is accepted, build a reviewed release using [the packer](lambda-pack.md). Use its actual output directory:

```sh
npm run lambda:deploy:dev -- --config .artifacts/deploy.dev.json --artifact .artifacts/lambda/release-candidate

# Optional stricter gate: all six migration phases completed, target/config match,
# no outstanding lock, and protected snapshot hashes still match.
npm run lambda:deploy:dev -- --config .artifacts/deploy.dev.json --artifact .artifacts/lambda/release-candidate --migration-receipt /absolute/eureka-checkout/scripts/migrate/runs/lemon-templates-api-dev/templates-receipt.json
```

Both commands are offline. After reviewing that exact artifact/config, add `--apply` to the same command. `--migration-receipt` is optional because some installations are already managed; supplying it makes failed/incomplete/unknown or altered migration state a hard gate. The dev wrapper rejects prod, bootstrap and other projects before an environment file can be read. It snapshots the validated code-only config into a temporary 0700 directory with a 0600 file, reuses the existing loader on that immutable input, then removes the temporary copy. Editing the original config during artifact loading cannot change this invocation's target. A hard kill can leave that private temporary copy for manual cleanup. It reuses artifact validation, SigV4 transport, live managed-function preflight, receipts and outcome handling from [lambda:deploy](lambda-deploy.md); it does not create a second deployment implementation.

The ZIP must target Node 24/x86_64. Code mode updates both managed functions without changing environment, runtime, memory, routes or wiring. It cannot fix an older runtime or migrate Serverless ownership implicitly. Optional `expect` retains the existing application-payload verification contract; successful Lambda invocation alone does not prove application HTTP 200.

## Local verification

```sh
npm run lambda:migrate -- --help
npm run lambda:migrate -- plan --config .artifacts/migration.dev.json
```

Since lemon-core 5.0.13 (v5 B19) the tools are the lemon-core bins `lemon-lambda-migrate` and `lemon-lambda-deploy-dev`, with this service's target pinned in lemon-core (reference: lemon-core `docs/v5/B19-bin-deploy.md`). Their synthetic tests run in lemon-core (`npm test`, the `migrate-core`, `migrate-diagnostic` and `dev-release` specs). The tests cover phase/consent/target gates, valid and corrupted receipts, changed backups, zero-exit warnings, private permissions/symlinks, concurrent attempts, real process success/deadline/cancellation, parent SIGKILL, last-line progress capture, and dev-only deployment reuse. They do not contact AWS or run the real migration source. Diagnostic regressions include actual synthetic child exceptions with positive file/line checks, recognized AWS CLI headers, unknown fields, supplied getters/proxies, malicious IPC, raw-secret omission, direct process exits and unchanged receipt/CLI failure semantics.

An additional offline check used the actual prepared dev config and a fresh pack artifact from source `719e53de1a9e96c23a48d23263cabc8ff025a10e`: migration plan 192.65 ms and dev ZIP plan 2653.38 ms. Node fetch/http/https/net connection paths were blocked by a test preload; this was not an OS security sandbox. These results establish local preparation/compatibility, not successful live migration or release deployment.

### Subsequent dev rehearsal

After the initial offline verification, a separately authorized dev migration and code deployment succeeded using source `6f8f84d6a58db1afce3949fd5f536da2e79d9b96`. The operating session checked both functions: each retained the same 20 environment entries as its baseline, and both API probes returned HTTP 200. All five loop checks passed; the observed individual delivery times were 496, 3124, 216, 300 and 58 ms. The code deployment took 20.085 seconds.

These are results from that single subsequent dev rehearsal, not measurements of this diagnostic patch or a general latency guarantee. The diagnostic patch itself was exercised with synthetic local failures only; it did not repeat the migration or deployment. Private backups, environment values, account identifiers and resource identities remain outside this shared document.
