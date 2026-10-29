#!/usr/bin/env node
/**
 * `bin/fields-types.mjs`
 * - check that one field name has one type across the stored models of one OpenSearch index (`$FIELD` models).
 * - usage: `npm run fields:types` / `npm run fields:types -- --root ../other-api --json > other.json`
 * - all logic is in `lib/fields-types.mjs`; this file only sets the exit code.
 */
import { run } from './lib/fields-types.mjs';

// run on the real file system; `run` never throws and returns the exit code.
process.exitCode = run(process.argv.slice(2));
