# Lambda ZIP packaging

`npm run pack` builds a Lambda deployment ZIP and an external verification manifest. It uses Node built-ins and Docker; no host `node_modules`, Python, `zip`, Serverless, AWS profile, or deployment credentials are needed. Existing `pack.lemon` and `pack.lemon.prod` commands retain their Serverless behavior.

## Run

Install Node >=24, Git and Docker. Docker must be able to run the selected Linux architecture (Docker Desktop emulation or a matching Linux machine).

```sh
npm run pack
npm run pack -- --architecture arm64
npm run pack -- --output .artifacts/lambda/release-candidate
npm run pack -- --help
```

Run from the repository root. The default target is `nodejs24.x` / `x86_64` (`linux/amd64`); `arm64` selects `linux/arm64`. Unsupported runtimes and architectures fail. The tool verifies Linux, Node major 24, Amazon Linux 2023, and the selected CPU architecture inside the actual image. A missing or mismatched image is pulled; Docker/emulation failure never falls back to host execution.

The default output is a new directory under `.artifacts/lambda/`, containing:

- `lambda.zip`: deployable files with `handler.js` at the root; configure the Lambda handler as `handler.lambda`.
- `manifest.json`: Git SHA and dirty status, source snapshot hashes, original and staging lock hashes, effective config hash, image ID/digests and exact Node/OS versions, target architecture, host packer Node/zlib/platform/architecture, ZIP hash/size, each file's hash/size/permissions, native module paths, timings and validation results.

`--output` selects a **new directory**, not a ZIP filename. Existing destinations are rejected. Both files are published by one directory rename only after all checks pass. Failed attempts return nonzero and leave no result at that destination. Normal failure cleans temporary build/staging directories; abrupt process termination or Docker daemon failure can leave temporary `lambda-pack-*` directories or containers. Inspect them before cleanup. Nothing is uploaded or deployed.

## Pipeline and boundaries

1. Copy the configured source allowlist into a temporary build workspace. Package/lock files, handler, TypeScript configs, `src/` and runtime `data/` are the current inputs. `node_modules`, existing `dist`, Git metadata, `env`, `.env*`, `.aws`, `.npmrc`, dotfiles inside source trees, and secret/credential/key filenames are excluded. Direct source symlinks and paths escaping through ancestor symlinks fail. This is a file boundary, not a scanner for secrets embedded in ordinary source or data: review allowed inputs before packaging.
2. Validate the original package/lock root declarations, then run `npm ci --include=dev` and the existing `npm run build` in the Lambda image. This retains field generation and TypeScript build behavior in isolation. The original checkout is never an installation or build mount.
3. Create a separate production install workspace. Remove only root `scripts` and `devDependencies` from its package manifest and matching root lock metadata; retain the entire locked dependency graph. Run `npm ci --omit=dev`. Removing the root dev declarations prevents a dev-only optional peer such as TypeScript from being promoted into production. Production dependencies and their required/optional peer relationships remain intact. The source package and lockfile are unchanged. Local/file/workspace dependencies are unsupported and fail before Docker work.
4. Stage `handler.js`, the deployment package manifest, compiled runtime files and source maps, `data/`, and the separate production `node_modules`. Exclude project test/spec/declaration files, build caches and tools. The deployment manifest omits root scripts/devDependencies. Dependency package contents, including `src/`, declarations, executable files and confined symlinks, are preserved; extension-based pruning is never applied inside dependencies. npm's private `node_modules/.package-lock.json` ledger is excluded.
5. Write a ZIP with sorted UTF-8 paths, fixed `1980-01-01` timestamps and normalized Unix modes (`0644` files, `0755` executables, symlinks preserved). Extract the ZIP into another clean directory and verify archived content against its hashes.
6. Load that **extracted** root handler in the same resolved image ID, with networking disabled, a read-only root filesystem and artifact mount, and only `/tmp` writable. Set a synthetic Lambda function name, execution environment and task root so Lambda-specific initialization branches run; no credentials or service settings are injected. Require `handler.lambda` to be a function and require a clean process exit within 60 seconds. A wrong handler, missing import, load error, hanging initialization or nonzero exit prevents publication.

Build and npm download stages need network access. No host environment variables, AWS credentials, home directory or npm config are passed into the containers. Dependency scripts follow the selected image's npm policy and any project `allowScripts`; the tool does not globally approve scripts. Recent npm releases may skip unapproved install hooks. Native files are inventoried, but handler loading proves only paths loaded during initialization; native modules loaded later still need targeted Linux tests and any necessary reviewed npm script policy. The current smoke does not invoke API handlers or AWS services and does not replace deployment/integration tests.

## Configuration and size limits

`pack.config.json` is the project adapter. It defines the source allowlist, runtime paths, handler file/export, npm build script, image, default runtime/architecture, output root, and byte limits. The core modules contain no service name or repository-specific paths. `--config <file>` selects another JSON adapter; `--runtime`, `--architecture` and `--output` override their respective defaults. Paths in the adapter are relative to the current repository root. Unknown fields, traversal paths, duplicate/overlapping source lists and forbidden paths fail.

The image defaults to `public.ecr.aws/lambda/nodejs:24`. The tool resolves one immutable local image ID and uses it for every phase, recording available repository digests. To pin future runs, set `image` to `public.ecr.aws/lambda/nodejs:24@sha256:<digest>` using the recorded digest for the desired image. The moving tag can change Node/npm/OS patch versions between runs; it is not a reproducible-build pin.

The default compressed limit is 50 MiB and the uncompressed limit is 250 MiB. A larger compressed budget up to 250 MiB can be set for an S3 upload workflow; this command still performs no upload. The Lambda uncompressed quota also includes layers, which are outside this ZIP and must be accounted for separately. ZIP32's 65,535-entry limit is enforced. The writer reads/compresses one file at a time; ZIP extraction reads the compressed archive into host memory.

Identical staged files produce identical ZIP bytes with the same packer Node/zlib versions, regardless of source timestamps, traversal order, or host timezone. Compression uses the host Node/zlib recorded in `manifest.packer`, not the container Node runtime. Full-build reproducibility also depends on the container image/npm versions, registry contents and install/build scripts. Manifests intentionally vary with creation time and measured durations. `timingsMs.total` measures through verification and temporary workspace cleanup, before manifest writing and atomic publication; `timingsMs.cleanup` records the cleanup phase separately. The manifest records the Git SHA plus dirty status and a hash inventory of the actual copied inputs so uncommitted input is explicit.

## Verification and maintenance

The `pack` tests of lemon-core (`npm test` there) run offline fixtures for strict options, path and credential boundaries, source/host isolation, lock mismatch, staging manifest/peer preservation, failure propagation, ZIP metadata/reproducibility, symlink containment, size limits and atomic publication. Its Docker runner is simulated; a real `npm run pack` run is the Linux integration gate. Use an independent ZIP reader for release inspection, for example:

```sh
unzip -t .artifacts/lambda/release-candidate/lambda.zip
unzip -l .artifacts/lambda/release-candidate/lambda.zip
```

Check the manifest's runtime/architecture, validation statuses, native modules, source dirty state, image identity and size before selecting the ZIP for deployment. The existing service test suite is separate from this packaging gate.

Since lemon-core 5.0.13 (v5 B19) the packer is the lemon-core bin `lemon-lambda-pack`; `npm run pack` calls it from the service root. It is the thin CLI; lemon-core's `pack-core.mjs` owns orchestration and file policy and `pack-zip.mjs` owns deterministic ZIP creation/extraction. `pack.config.json` stays this project's adapter. Generic reference: lemon-core `docs/v5/B19-bin-deploy.md`.

## Official references

- [AWS: Deploy Node.js Lambda functions with ZIP archives](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html) — handler layout, dependencies and deployment packaging.
- [AWS: Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) — compressed upload and uncompressed deployment package limits, including layers.
- [npm: npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) — lockfile requirements, clean installs and dependency omission.
