#!/usr/bin/env node
/**
 * `bin/fields-admin.mjs`
 * - check `GET /<type>/fields/admin` on the local express server or the deployed Lambda (`checkFieldsAdmin()`).
 * - usage: `npm run fields:admin -- --target express` / `npm run fields:admin -- --target lambda --stage dev`
 * - all logic is in `lib/fields-admin.mjs`; this file only sets the exit code.
 */
import { run } from './lib/fields-admin.mjs';

// run with the real transports; `run` never throws and returns the exit code.
run(process.argv.slice(2)).then(code => {
    process.exitCode = code;
});
