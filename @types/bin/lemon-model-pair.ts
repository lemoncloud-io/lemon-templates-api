/**
 * `bin/lemon-model-pair.ts`
 * - the `lemon-model` version that the installed `lemon-core` declares (its pair): the only version the `@types` package may name.
 * - resolved from lemon-core's own folder (not from the service root), and checked against the service's `lemon-core` range,
 *   so a stale `node_modules` (an old lemon-core, or an old hoisted lemon-model) fails loudly instead of writing a wrong version.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-11-03 D107: initial version (found when a stale install wrote `^1.0.6`).
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import path from 'path';
import fs from 'fs';

//* json loader.
const loadJson = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));

//* `x.y.z` → [x, y, z] (prerelease/build dropped).
const parse = (v: string): number[] =>
    v
        .replace(/^[\^~=v\s]+/, '')
        .split(/[-+]/)[0]
        .split('.')
        .map(n => parseInt(n, 10) || 0);

//* compare two parsed versions: <0, 0, >0.
const cmp = (a: number[], b: number[]) => [0, 1, 2].reduce((r, i) => r || (a[i] || 0) - (b[i] || 0), 0);

//* minimal semver check for the ranges used here: exact `x.y.z`, caret `^x.y.z`, tilde `~x.y.z`.
export const satisfies = (version: string, range: string): boolean => {
    const v = parse(version);
    const r = parse(range);
    if (range.startsWith('^')) return v[0] === r[0] && cmp(v, r) >= 0;
    if (range.startsWith('~')) return v[0] === r[0] && v[1] === r[1] && cmp(v, r) >= 0;
    return cmp(v, r) === 0;
};

/**
 * the lemon-core / lemon-model pair installed for a service.
 * @param serviceDir the service root (holds `package.json` and `node_modules`)
 */
export const lemonModelPair = (serviceDir: string) => {
    //* the service's own lemon-core range.
    const $svc = loadJson(path.join(serviceDir, 'package.json'));
    const range: string = $svc.dependencies?.['lemon-core'] ?? $svc.devDependencies?.['lemon-core'];
    if (!range)
        throw new Error(
            `lemon-core is not a dependency of ${$svc.name} - the @types package needs its lemon-model pair`,
        );

    //* the installed lemon-core, resolved from the service root.
    const corePkg = require.resolve('lemon-core/package.json', { paths: [serviceDir] });
    const core = loadJson(corePkg);
    if (!satisfies(core.version, range))
        throw new Error(
            `installed lemon-core ${core.version} does not satisfy ${range} (stale node_modules?) - run: npm ci`,
        );

    //* the lemon-model that this lemon-core declares and resolves (from its own folder, never from the service root).
    const declared: string = core.dependencies?.['lemon-model'];
    if (!declared) throw new Error(`lemon-core ${core.version} declares no lemon-model - cannot name the pair`);
    const modelPkg = require.resolve('lemon-model/package.json', { paths: [path.dirname(corePkg)] });
    const model = loadJson(modelPkg);
    if (!satisfies(model.version, declared))
        throw new Error(
            `installed lemon-model ${model.version} is not the pair of lemon-core ${core.version} (declares ${declared}) - run: npm ci`,
        );
    return {
        coreVersion: core.version as string,
        coreRange: range,
        modelVersion: model.version as string,
        modelDeclared: declared,
    };
};
