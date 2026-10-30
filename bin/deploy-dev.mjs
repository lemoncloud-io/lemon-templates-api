#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDeployArgs } from './deploy.mjs';
import { runDevRelease, DeployError } from './lib/dev-release.mjs';
import { MigrationError } from './lib/migrate-core.mjs';

export function parseDevArgs(argv) {
    const forwarded = [];
    let migrationReceipt;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--migration-receipt') {
            const value = argv[++i];
            if (migrationReceipt || !value || value.startsWith('--'))
                throw new MigrationError('INVALID_ARGS', 'Invalid or duplicate --migration-receipt.');
            migrationReceipt = path.resolve(value);
        } else forwarded.push(argv[i]);
    }
    return { ...parseDeployArgs(forwarded), ...(migrationReceipt ? { migrationReceipt } : {}) };
}
export async function main(argv = process.argv.slice(2), deps = {}) {
    const { stdout = console.log, stderr = console.error } = deps;
    try {
        const options = parseDevArgs(argv);
        if (options.help) {
            stdout(
                'Usage: npm run lambda:deploy:dev -- --config <dev-code-config> --artifact <pack-directory> [--migration-receipt <verified-receipt>] [--apply] [--receipt-dir <directory>]\nDefault is an offline plan; only lemon-templates-api/dev/code is supported. Existing deploy ownership and artifact checks remain active.',
            );
            return 0;
        }
        stdout(JSON.stringify(await runDevRelease(options, deps), null, 2));
        return 0;
    } catch (error) {
        const known = error instanceof DeployError || error instanceof MigrationError;
        stderr(
            JSON.stringify({
                status: known && error.unknown ? 'unknown' : 'failed',
                code: known ? error.code : 'PREPARATION_FAILED',
                message: known ? error.message : 'Could not prepare dev deployment; raw errors are not logged.',
                ...(known && error.receipt ? { receipt: error.receipt } : {}),
                ...(known && error.deployId ? { deployId: error.deployId } : {}),
            }),
        );
        return (
            error.exitCode ??
            (known && ['INVALID_INPUT', 'INVALID_ARGS', 'TARGET_MISMATCH', 'PLACEHOLDER_INPUT'].includes(error.code)
                ? 2
                : 1)
        );
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const controller = new AbortController(),
        stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        process.exitCode = await main(undefined, { signal: controller.signal });
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
