import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeployError, loadDeployment, deploymentPlan, validateConfig, readJson } from './deploy-plan.mjs';
import { runDeployment } from './deploy-runner.mjs';
import { TARGET, MigrationError, rejectPlaceholders, verifyMigrationReceipt } from './migrate-core.mjs';

export async function runDevRelease(
    options,
    { clientFactory, run = runDeployment, load = loadDeployment, signal } = {},
) {
    const candidate = validateConfig(await readJson(options.configFile, 'config JSON'));
    if (candidate.project !== TARGET.project || candidate.stage !== 'dev' || candidate.mode !== 'code')
        throw new MigrationError('TARGET_MISMATCH', 'Dev deployment requires lemon-templates-api/dev/code config.');
    // Preserve the reviewed code-only config while reusing the existing artifact loader.
    // Code mode has no config-relative environment file; this snapshot cannot read one.
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'templates-dev-config-'));
    let deployment;
    try {
        const configFile = path.join(temporary, 'config.json');
        await writeFile(configFile, JSON.stringify(candidate), { mode: 0o600, flag: 'wx' });
        deployment = await load({ ...options, configFile });
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
    const c = deployment.config;
    if (c.project !== TARGET.project || c.stage !== 'dev' || c.mode !== 'code')
        throw new MigrationError('TARGET_MISMATCH', 'Dev deployment requires lemon-templates-api/dev/code config.');
    const migration = options.migrationReceipt ? await verifyMigrationReceipt(options.migrationReceipt, c) : undefined;
    if (!options.apply) return { ...deploymentPlan(deployment), ...(migration ? { migration } : {}) };
    rejectPlaceholders(c);
    const create = clientFactory ?? (await import('./deploy-client.mjs')).createDeployClient;
    return run(deployment, { client: await create(c), receiptDirectory: options.receiptDirectory, signal });
}
export { DeployError };
