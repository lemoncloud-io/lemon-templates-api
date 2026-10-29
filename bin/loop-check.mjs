#!/usr/bin/env node
/**
 * `bin/loop-check.mjs`
 * - check the SNS / SQS / protocol loop test of the deployed service from its CloudWatch log lines.
 * - usage: `npm run loop:check -- --stage dev --profile <name>` / `npm run loop:check -- --kind sns`
 * - local: `npm run loop:check -- --target express [--port <n>]` (server: `npm run express.lemon`, `LOCAL_TRANSPORT=mock`)
 * - all logic is in `lib/loop-check.mjs`; this file only sets the exit code.
 */
import { run } from './lib/loop-check.mjs';

// run with the real transports; `run` never throws and returns the exit code.
run(process.argv.slice(2)).then(code => {
    process.exitCode = code;
});
