#!/usr/bin/env node
/**
 * `bin/sync-v5-tooling.mjs` — port the v5 tooling of this repository (the recipe) into other v5 service checkouts.
 *
 * Items (`--only` picks a subset):
 *  - `pkg`   : Serverless Framework removal (packages, `sls` scripts, dev guard, docs/serverless.md record),
 *              deepmerge-safe + minimatch / test-exclude overrides, lemon-core and nodemon floors,
 *              unused dev deps (codecov, typedoc, @types/cors|request|uuid) when nothing uses them;
 *              packages only the removed Serverless set provided that are still used are reported (never added).
 *  - `bin`   : `bin/deploy-dev.sh` + `npm run deploy:dev`, `bin/ship-check.sh` + `npm run ship:check`, `.gitignore` entries,
 *              docs/lambda-tools.md rows + sections and README rows
 *              (the README table = the one with `npm run lambda:*` rows, 2-4 columns, any header language).
 *  - `types` : `@types` names lemon-model only (D107): rewrite-imports / verify-types / lemon-model-pair,
 *              init-package patch, tsconfig.verify.json, `incremental: false`, eslint override, stale tsbuildinfo.
 *
 * Dry-run by default: prints what would change. `--apply` writes. Nothing is installed, built or committed here —
 * after `--apply` run `npm install`, `npm run types`, the gates, then review `git diff` (see docs/sync-v5-tooling.md).
 *
 * ```sh
 * $ node bin/sync-v5-tooling.mjs --target ../codes-backend-api                 # report only
 * $ node bin/sync-v5-tooling.mjs --target ../codes-backend-api --apply         # write
 * $ node bin/sync-v5-tooling.mjs --target A --target B --sls keep --only pkg,bin --json out.json
 * ```
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-11-03 v5 B42: initial version (lemon-templates-api `v5` = the source of every copied file).
 * @date        2026-11-03 v5 B42 r4: transitive Serverless packages noted, README `lambda:*` table detection widened.
 * @date        2026-11-03 v5 M2-P1: bin item also ports bin/ship-check.sh + npm run ship:check
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import fs from 'fs';
import { builtinModules } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------
//* this repository (the recipe) is the folder above `bin/`.
const SOURCE_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITEMS = ['pkg', 'bin', 'types'];
//* profiles that mean the `lemon` account (dev stage owned by the deploy service); anything else is another account.
const LEMON_PROFILES = new Set(['lemon', 'dou-lemon', 'osx-lemon', 'none']);
//* dev packages of the Serverless Framework and its plugins.
const SLS_PACKAGE = /^(serverless(-.+)?|@cruglobal\/serverless-merge-config)$/;
//* a script that only works with the Serverless Framework (or the B38 guard that replaced one).
const SLS_SCRIPT = /(^|\s|&&\s*)(sls|serverless)\s|migrated-stage-guard\.mjs/;
//* dev deps dropped when nothing uses them (templates #55 / fb0ceb4, cognitos R2).
const TYPEDOC_DEPS = ['typedoc', 'typedoc-plugin-markdown', 'typedoc-plugin-rename-defaults'];
const TYPES_DEPS = { '@types/cors': 'cors', '@types/request': 'request', '@types/uuid': 'uuid' };

//* parse argv into options (strict: an unknown flag stops).
const parseArgs = argv => {
    const o = { targets: [], apply: false, sls: 'auto', only: ITEMS, json: '', source: SOURCE_DEFAULT };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        if (a === '--target') o.targets.push(path.resolve(next()));
        else if (a === '--apply') o.apply = true;
        else if (a === '--sls') o.sls = next();
        else if (a === '--only')
            o.only = next()
                .split(',')
                .map(s => s.trim());
        else if (a === '--json') o.json = path.resolve(next());
        else if (a === '--source') o.source = path.resolve(next());
        else if (a === '-h' || a === '--help') {
            console.log(usage());
            process.exit(0);
        } else throw new Error(`unknown option: ${a} (see --help)`);
    }
    if (!o.targets.length) throw new Error('at least one --target <dir> is required');
    if (!['auto', 'full', 'keep'].includes(o.sls)) throw new Error(`--sls must be auto|full|keep (got ${o.sls})`);
    for (const it of o.only) if (!ITEMS.includes(it)) throw new Error(`--only: unknown item ${it}`);
    return o;
};
const usage = () => `Usage: node bin/sync-v5-tooling.mjs --target <dir> [--target <dir> ...] [options]
  --apply              write the changes (default: report only)
  --sls auto|full|keep Serverless removal: auto = full unless a script deploys to another account's profile
  --only pkg,bin,types items to run (default: all three)
  --json <file>        also write the report as JSON
  --source <dir>       the recipe checkout (default: this repository)`;

// ---------------------------------------------------------------------------------------------------------------------
// small fs helpers (every write goes through `ctx` so the dry-run stays read-only)
// ---------------------------------------------------------------------------------------------------------------------
const exists = p => fs.existsSync(p);
const read = p => fs.readFileSync(p, 'utf8');
//* JSON text keeps the file's own indentation (2 or 4 spaces) and its trailing newline.
const jsonStyle = txt => ({ indent: (txt.match(/\n( +)"/) || [, '  '])[1], eol: txt.endsWith('\n') ? '\n' : '' });
const stringify = (obj, style) => JSON.stringify(obj, null, style.indent) + style.eol;
//* compare two semver-ish ranges by their numeric part (`^5.0.22` < `^5.0.23`); unknown shapes compare as equal.
const numeric = v => {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? [+m[1], +m[2], +m[3]] : null;
};
const lower = (a, b) => {
    const x = numeric(a);
    const y = numeric(b);
    if (!x || !y) return false;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
};
//* walk a folder and return files matching the extension filter (skips node_modules / dist / .git).
const walk = (dir, exts, out = []) => {
    if (!exists(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git', '.artifacts', 'coverage'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, exts, out);
        else if (exts.some(x => e.name.endsWith(x))) out.push(p);
    }
    return out;
};

//* per-target context: paths, the report, and the write/remove primitives that respect --apply.
const makeCtx = (target, source, apply) => {
    const ctx = { target, source, apply, name: '', actions: [], notes: [], owner: [] };
    const rel = p => path.relative(target, p) || '.';
    ctx.act = (item, kind, file, note = '') => ctx.actions.push({ item, kind, file: rel(file), note });
    ctx.note = (item, text) => ctx.notes.push({ item, text });
    ctx.ownerItem = (item, text) => ctx.owner.push({ item, text });
    ctx.write = (item, file, content, note = '') => {
        const before = exists(file) ? read(file) : null;
        if (before === content) return false;
        ctx.act(item, before === null ? 'create' : 'update', file, note);
        if (apply) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
        return true;
    };
    ctx.remove = (item, file, note = '') => {
        if (!exists(file)) return false;
        ctx.act(item, 'delete', file, note);
        if (apply) fs.rmSync(file);
        return true;
    };
    //* copy a recipe file verbatim (mode kept for executables).
    ctx.copy = (item, relPath, note = '') => {
        const src = path.join(source, relPath);
        const dst = path.join(target, relPath);
        if (!exists(src)) throw new Error(`recipe file missing: ${relPath}`);
        const changed = ctx.write(item, dst, read(src), note || 'copied from the recipe');
        if (apply && changed) fs.chmodSync(dst, fs.statSync(src).mode & 0o777);
        return changed;
    };
    return ctx;
};

// ---------------------------------------------------------------------------------------------------------------------
// package.json helpers
// ---------------------------------------------------------------------------------------------------------------------
//* rebuild `scripts` with the given keys removed; a `!banner` whose group became empty goes too.
const dropScripts = (scripts, removeKeys) => {
    const keys = Object.keys(scripts);
    const kept = [];
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (removeKeys.has(k)) continue;
        if (k.startsWith('!')) {
            // group = following keys up to the next banner; drop the banner when all of them are removed
            let j = i + 1;
            let alive = false;
            while (j < keys.length && !keys[j].startsWith('!')) {
                if (!removeKeys.has(keys[j])) alive = true;
                j++;
            }
            if (!alive && j > i + 1) continue;
        }
        kept.push(k);
    }
    return Object.fromEntries(kept.map(k => [k, scripts[k]]));
};
//* insert `[key, value]` right after `afterKey` (or at the end) keeping the object order.
const insertAfter = (obj, afterKey, key, value) => {
    const out = {};
    let done = false;
    for (const [k, v] of Object.entries(obj)) {
        if (k === key) continue;
        out[k] = v;
        if (k === afterKey) {
            out[key] = value;
            done = true;
        }
    }
    if (!done) out[key] = value;
    return out;
};
//* the last script key of a group (by predicate) — used to place new scripts next to their siblings.
const lastKey = (obj, pred) => Object.keys(obj).filter(pred).pop();
//* true when any file under src/ (or a root script) imports the module.
const importedSomewhere = (target, mod) => {
    const files = [
        ...walk(path.join(target, 'src'), ['.ts', '.js']),
        ...walk(path.join(target, 'scripts'), ['.ts', '.js', '.mjs']),
    ];
    for (const f of ['handler.js', 'jest.config.js'])
        if (exists(path.join(target, f))) files.push(path.join(target, f));
    const re = new RegExp(`(from\\s*['"]${mod}(/|['"])|require\\(\\s*['"]${mod}(/|['"]))`);
    return files.filter(f => re.test(read(f))).map(f => path.relative(target, f));
};

// ---------------------------------------------------------------------------------------------------------------------
// package-lock.json helpers (transitive packages of the removed Serverless set)
// ---------------------------------------------------------------------------------------------------------------------
//* node resolution inside the lock: `name` seen from the package at `from` (`''` = the root).
const lockResolve = (pkgs, from, name) => {
    for (let base = from; ; ) {
        const cand = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
        if (pkgs[cand]) return cand;
        if (!base) return null;
        const i = base.lastIndexOf('/node_modules/');
        base = i >= 0 ? base.slice(0, i) : '';
    }
};
//* the names a lock entry pulls in: dependencies, optional ones, and the peers npm installs (not the optional peers).
const lockEdges = e => [
    ...Object.keys(e.dependencies || {}),
    ...Object.keys(e.optionalDependencies || {}),
    ...Object.keys(e.peerDependencies || {}).filter(p => !(e.peerDependenciesMeta || {})[p]?.optional),
];
//* every lock path reachable from the root names (links followed to their folder).
const lockClosure = (pkgs, names) => {
    const seen = new Set();
    const queue = names.map(n => lockResolve(pkgs, '', n)).filter(Boolean);
    while (queue.length) {
        const p = queue.shift();
        if (seen.has(p)) continue;
        seen.add(p);
        const e = pkgs[p];
        // a `file:` link: its dependencies resolve from the linked folder
        const at = e.link && e.resolved && pkgs[e.resolved] ? e.resolved : p;
        if (at !== p) queue.push(at);
        for (const n of lockEdges(pkgs[at])) {
            const r = lockResolve(pkgs, at, n);
            if (r && !seen.has(r)) queue.push(r);
        }
    }
    return seen;
};
//* `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`.
const packageOf = spec =>
    spec
        .split('/')
        .slice(0, spec.startsWith('@') ? 2 : 1)
        .join('/');
//* bare module specifiers: `from 'x'`, `import 'x'`, `import('x')`, `require('x')` (relative and node builtins skipped).
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"./][^'"]*)['"]/g;
//* package -> ['file:line', ...] over the given files.
const scanImports = (target, files) => {
    const out = {};
    for (const f of files) {
        read(f)
            .split('\n')
            .forEach((line, i) => {
                for (const m of line.matchAll(SPEC_RE)) {
                    if (m[1].startsWith('node:') || builtinModules.includes(m[1])) continue;
                    const name = packageOf(m[1]);
                    (out[name] = out[name] || []).push(`${path.relative(target, f)}:${i + 1}`);
                }
            });
    }
    return out;
};
//* the files whose imports must still resolve: src/, scripts/, root scripts, and the typings of the `@lemoncloud/*` deps
//* (`missing` lists the `@lemoncloud/*` deps that are not installed, so their typings were not read).
const importSites = (target, pkg, missing = []) => {
    const files = [
        ...walk(path.join(target, 'src'), ['.ts', '.js', '.mjs', '.cjs']),
        ...walk(path.join(target, 'scripts'), ['.ts', '.js', '.mjs', '.cjs']),
        ...fs
            .readdirSync(target, { withFileTypes: true })
            .filter(e => e.isFile() && /\.(js|ts|mjs|cjs)$/.test(e.name))
            .map(e => path.join(target, e.name)),
    ];
    // the installed `@lemoncloud/*` typings (only when node_modules is there)
    const declared = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
    for (const d of declared.filter(d => d.startsWith('@lemoncloud/'))) {
        const dir = path.join(target, 'node_modules', d);
        if (exists(dir)) files.push(...walkTypings(dir));
        else missing.push(d);
    }
    return files;
};
//* every `.d.ts` under an installed package (its own nested node_modules skipped; `dist` is where typings live).
const walkTypings = (dir, out = []) => {
    if (!exists(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkTypings(p, out);
        else if (e.name.endsWith('.d.ts')) out.push(p);
    }
    return out;
};

/**
 * packages that only the removed Serverless set provided (per the target's package-lock.json) and that are still used:
 * imported by an import site, or an optional peer of a declared package. Reported as notes, never added.
 */
const transitiveLeftovers = (target, lock, pkg, removedNames) => {
    const pkgs = (lock && lock.packages) || null;
    if (!pkgs || !removedNames.length) return { found: [], unscanned: [] };
    const declaredNames = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        ...Object.keys(pkg.optionalDependencies || {}),
    ];
    // reachable from what stays declared vs. reachable from each removed package
    const kept = lockClosure(pkgs, declaredNames);
    const byRemoved = removedNames.map(n => [n, lockClosure(pkgs, [n])]);
    const providers = p => byRemoved.filter(([, set]) => set.has(p)).map(([n]) => n);
    //* the hoisted path of a name that only the removed set reaches (null when declared, kept or unrelated).
    const lostTop = name => {
        const p = `node_modules/${name}`;
        return !declaredNames.includes(name) && pkgs[p] && !kept.has(p) && providers(p).length ? p : null;
    };
    const found = new Map(); // name -> { name, version, via, uses }
    //* record one use of a lost package.
    const add = (name, use) => {
        const p = lostTop(name);
        if (!p) return;
        const f = found.get(name) || { name, version: pkgs[p].version, via: providers(p), uses: [] };
        f.uses.push(use);
        found.set(name, f);
    };
    // 1. imported directly by the service (or by its `@lemoncloud/*` typings)
    const unscanned = [];
    const imports = scanImports(target, importSites(target, pkg, unscanned));
    for (const [name, sites] of Object.entries(imports))
        add(name, `imported by ${sites.slice(0, 3).join(', ')}${sites.length > 3 ? ` (+${sites.length - 3})` : ''}`);
    // 2. an optional peer of a declared package (npm does not install those on its own)
    for (const d of declaredNames) {
        const e = pkgs[`node_modules/${d}`];
        if (!e) continue;
        for (const [peer, meta] of Object.entries(e.peerDependenciesMeta || {})) {
            if (!meta.optional) continue;
            const users = imports[d] ? ` (${d} is imported by ${imports[d].slice(0, 2).join(', ')})` : '';
            add(peer, `optional peer of ${d}${users}`);
        }
    }
    return { found: [...found.values()], unscanned };
};

// ---------------------------------------------------------------------------------------------------------------------
// item: pkg
// ---------------------------------------------------------------------------------------------------------------------
const runPkg = (ctx, opt) => {
    const item = 'pkg';
    const pkgFile = path.join(ctx.target, 'package.json');
    const raw = read(pkgFile);
    const style = jsonStyle(raw);
    const pkg = JSON.parse(raw);
    const srcPkg = JSON.parse(read(path.join(ctx.source, 'package.json')));
    const lock = exists(path.join(ctx.target, 'package-lock.json'))
        ? JSON.parse(read(path.join(ctx.target, 'package-lock.json')))
        : null;
    const lockedVersion = name =>
        lock && lock.packages && lock.packages[`node_modules/${name}`]
            ? lock.packages[`node_modules/${name}`].version
            : '?';
    pkg.dependencies = pkg.dependencies || {};
    pkg.devDependencies = pkg.devDependencies || {};
    pkg.scripts = pkg.scripts || {};

    // ---- 1. Serverless: decide the mode from the profiles the sls scripts deploy to
    const slsScripts = Object.entries(pkg.scripts).filter(([k, v]) => !k.startsWith('!') && SLS_SCRIPT.test(v));
    const foreign = new Set();
    for (const [, v] of slsScripts) {
        for (const m of v.matchAll(/profile=['"]?([a-z0-9-]+)/g)) if (!LEMON_PROFILES.has(m[1])) foreign.add(m[1]);
        for (const m of v.matchAll(/--aws-profile\s+([a-z0-9-]+)/g)) if (!LEMON_PROFILES.has(m[1])) foreign.add(m[1]);
    }
    const slsPkgs = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].filter(k =>
        SLS_PACKAGE.test(k),
    );
    const mode = opt.sls === 'auto' ? (foreign.size ? 'keep' : 'full') : opt.sls;
    ctx.sls = { mode, foreign: [...foreign].sort(), packages: slsPkgs.length, scripts: slsScripts.length };
    //* the Serverless packages this run removes (their transitive packages are checked at the end).
    let slsRemoved = [];
    if (mode === 'keep') {
        if (slsPkgs.length || slsScripts.length)
            ctx.ownerItem(
                item,
                `Serverless kept (${
                    opt.sls === 'auto' ? `scripts deploy to other accounts: ${[...foreign].join(', ')}` : '--sls keep'
                }): ` +
                    `${slsPkgs.length} package(s), ${slsScripts.length} script(s) untouched — eureka-hello #20 style partial tidy stays; full removal (D85) is the owner's call`,
            );
    } else if (
        slsPkgs.length ||
        slsScripts.length ||
        exists(path.join(ctx.target, 'scripts/migrated-stage-guard.mjs'))
    ) {
        // packages (record the declared range and the locked version for docs/serverless.md)
        const removedPkgs = slsPkgs.map(k => ({
            name: k,
            range: pkg.devDependencies[k] || pkg.dependencies[k],
            version: lockedVersion(k),
        }));
        for (const k of slsPkgs) {
            delete pkg.devDependencies[k];
            delete pkg.dependencies[k];
        }
        slsRemoved = slsPkgs;
        // scripts
        const removedScripts = slsScripts.map(([k, v]) => ({ key: k, value: v }));
        // a script whose only job is `npm run <removed>` (server-local, server.lemon) goes with it, transitively
        for (let grew = true; grew; ) {
            grew = false;
            const gone = new Set(removedScripts.map(s => s.key));
            for (const [k, v] of Object.entries(pkg.scripts)) {
                if (k.startsWith('!') || gone.has(k)) continue;
                const calls = [...v.matchAll(/npm run ([^\s"']+)/g)].map(m => m[1]);
                if (calls.length && calls.some(c => gone.has(c))) {
                    removedScripts.push({ key: k, value: v });
                    grew = true;
                }
            }
        }
        pkg.scripts = dropScripts(pkg.scripts, new Set(removedScripts.map(s => s.key)));
        // `!lambda` banner: the two known phrases that say "sls scripts stay"
        if (pkg.scripts['!lambda']) {
            pkg.scripts['!lambda'] = pkg.scripts['!lambda']
                .replace(
                    'the sls scripts above stay, docs/serverless.md',
                    'Serverless removed, its last setup is in docs/serverless.md',
                )
                .replace(
                    'sls 스크립트는 남지만 패키지는 docs/serverless.md 대로 설치해야 동작한다',
                    'Serverless removed, its last setup is in docs/serverless.md',
                );
            if (/\bsls\b/.test(pkg.scripts['!lambda']))
                ctx.note(item, '`!lambda` banner still mentions sls — reword by hand');
        }
        ctx.act(
            item,
            'update',
            pkgFile,
            `Serverless removed: ${removedPkgs.length} package(s), ${removedScripts.length} script(s)`,
        );
        ctx.remove(
            item,
            path.join(ctx.target, 'scripts/migrated-stage-guard.mjs'),
            'B38 dev guard — no sls script calls it any more',
        );
        writeServerlessDoc(ctx, pkg, removedPkgs, removedScripts);
        // prose that still says sls is the deploy path: list it for the reviewer
        const readme = path.join(ctx.target, 'README.md');
        if (exists(readme)) {
            const hits = read(readme)
                .split('\n')
                .map((l, i) => [i + 1, l])
                .filter(([, l]) => /\bsls\b|deploy\.lemon|Serverless Framework/.test(l));
            if (hits.length)
                ctx.note(
                    item,
                    `README.md mentions sls / deploy.lemon on line(s) ${hits
                        .map(h => h[0])
                        .join(', ')} — reword to the lemon-* tools (templates README § 배포)`,
                );
        }
        const tools = path.join(ctx.target, 'docs/lambda-tools.md');
        if (exists(tools) && /stays installed|sls scripts/.test(read(tools)))
            ctx.note(item, 'docs/lambda-tools.md says Serverless stays installed — reword');
    }

    // ---- 2. overrides + deepmerge-safe (copied from the recipe so the three repos stay in sync)
    const want = {
        deepmerge: srcPkg.overrides.deepmerge,
        minimatch: srcPkg.overrides.minimatch,
        'test-exclude': srcPkg.overrides['test-exclude'],
    };
    pkg.overrides = pkg.overrides || {};
    const changedOverrides = Object.entries(want).filter(
        ([k, v]) => JSON.stringify(pkg.overrides[k]) !== JSON.stringify(v),
    );
    for (const [k, v] of changedOverrides) pkg.overrides[k] = v;
    if (changedOverrides.length)
        ctx.act(item, 'update', pkgFile, `overrides: ${changedOverrides.map(([k]) => k).join(', ')}`);
    if (pkg.devDependencies.deepmerge !== srcPkg.devDependencies.deepmerge) {
        pkg.devDependencies.deepmerge = srcPkg.devDependencies.deepmerge;
        ctx.act(item, 'update', pkgFile, `devDependencies.deepmerge = ${srcPkg.devDependencies.deepmerge}`);
    }
    ctx.copy(item, 'scripts/deepmerge-safe/index.js');
    ctx.copy(item, 'scripts/deepmerge-safe/package.json');

    // ---- 3. floors: lemon-core and nodemon follow the recipe when lower
    for (const [field, name] of [
        ['dependencies', 'lemon-core'],
        ['devDependencies', 'nodemon'],
    ]) {
        const cur = pkg[field][name];
        const ref = srcPkg[field][name];
        if (cur && lower(cur, ref)) {
            pkg[field][name] = ref;
            ctx.act(item, 'update', pkgFile, `${name} ${cur} -> ${ref}`);
        }
    }

    // ---- 4. unused dev deps
    const dropDev = (name, why) => {
        if (!(name in pkg.devDependencies)) return false;
        delete pkg.devDependencies[name];
        ctx.act(item, 'update', pkgFile, `devDependencies: -${name} (${why})`);
        return true;
    };
    // codecov: no script uses it
    if ('codecov' in pkg.devDependencies) {
        const users = Object.entries(pkg.scripts)
            .filter(([, v]) => /codecov/.test(v))
            .map(([k]) => k);
        if (!users.length) {
            dropDev('codecov', 'no script runs it');
            ctx.remove(item, path.join(ctx.target, '.codecov.yml'), 'codecov removed');
            const npmignore = path.join(ctx.target, '.npmignore');
            if (exists(npmignore)) {
                const txt = read(npmignore).replace(/\n# codecov\n\.codecov\.yml\n/, '\n');
                ctx.write(item, npmignore, txt, 'codecov lines removed');
            }
        } else ctx.note(item, `codecov kept: used by script(s) ${users.join(', ')}`);
    }
    // typedoc family: the docs scripts are its only users
    if (TYPEDOC_DEPS.some(d => d in pkg.devDependencies)) {
        const docScripts = Object.entries(pkg.scripts)
            .filter(([, v]) => /typedoc/.test(v))
            .map(([k]) => k);
        for (const d of TYPEDOC_DEPS) dropDev(d, 'typedoc removed');
        pkg.scripts = dropScripts(pkg.scripts, new Set(docScripts));
        if (docScripts.length) ctx.act(item, 'update', pkgFile, `scripts: -${docScripts.join(', -')}`);
        ctx.remove(item, path.join(ctx.target, 'typedoc.json'), 'typedoc removed');
    }
    if (!('typedoc' in pkg.devDependencies))
        ctx.remove(item, path.join(ctx.target, 'typedoc.json'), 'typedoc is not declared');
    // @types/x whose runtime module is neither declared nor imported
    for (const [typesPkg, mod] of Object.entries(TYPES_DEPS)) {
        if (!(typesPkg in pkg.devDependencies)) continue;
        const declared = mod in pkg.dependencies || mod in pkg.devDependencies;
        const imports = importedSomewhere(ctx.target, mod);
        if (!declared && !imports.length) dropDev(typesPkg, `${mod} is not declared or imported`);
        else
            ctx.note(
                item,
                `${typesPkg} kept: ${declared ? `${mod} is declared` : `imported by ${imports.join(', ')}`}`,
            );
    }
    if (pkg.devDependencies['js-yaml'] && lower(pkg.devDependencies['js-yaml'], '3.14.2'))
        ctx.note(
            item,
            `js-yaml ${pkg.devDependencies['js-yaml']} declared — run \`npm update js-yaml\` after install (templates: 3.15.2+)`,
        );

    // ---- 5. packages only the removed Serverless set provided that something still uses: reported, never added
    const leftovers = transitiveLeftovers(ctx.target, lock, pkg, slsRemoved);
    for (const t of leftovers.found)
        ctx.note(
            item,
            `${t.name} ${t.version} was only transitive via ${t.via.join(
                ', ',
            )} (package-lock.json) and is still used: ${t.uses.join(
                '; ',
            )} — declare it (dependencies if the runtime needs it, else devDependencies) or drop the use; not added automatically`,
        );
    if (leftovers.unscanned.length)
        ctx.note(
            item,
            `transitive check: ${
                leftovers.unscanned.length
            } @lemoncloud/* dep(s) not installed (${leftovers.unscanned.join(
                ', ',
            )}) — their typings were not read; run again before \`--apply\` with node_modules in place to check them`,
        );

    ctx.write(item, pkgFile, stringify(pkg, style));
    ctx.pkg = pkg;
};

//* docs/serverless.md in the templates / cognitos format, from what was just removed.
const writeServerlessDoc = (ctx, pkg, removedPkgs, removedScripts) => {
    const item = 'pkg';
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
        2,
        '0',
    )}`; // local date
    const ymls = fs
        .readdirSync(ctx.target)
        .filter(f => /^serverless.*\.ya?ml$/.test(f))
        .sort();
    const guarded = removedScripts.filter(s => /migrated-stage-guard\.mjs/.test(s.value));
    const offline = removedScripts.filter(s => /sls offline|server-local|npm run server\b/.test(s.value));
    const plain = removedScripts.filter(s => !guarded.includes(s) && !offline.includes(s));
    const packScript = pkg.scripts.pack ? 'pack' : pkg.scripts['lambda:pack'] ? 'lambda:pack' : 'lambda:pack';
    const hasDeployDev = !!pkg.scripts['deploy:dev'] || exists(path.join(ctx.target, 'bin/deploy-dev.sh'));
    const pkgRows = removedPkgs.length
        ? removedPkgs.map(p => `| \`${p.name}\` | \`${p.range}\` | ${p.version} |`).join('\n')
        : '| (패키지는 이미 지워져 있었다) | | |';
    const installCmd = removedPkgs.length
        ? `npm i -D ${removedPkgs
              .filter(p => p.name !== 'serverless-offline')
              .map(p => `${p.name}@${p.range}`)
              .join(' ')}`
        : '# (지울 때 남은 패키지 없음 — 아래 scripts 만 지웠다)';
    const lines = [
        '# Serverless Framework — 권장 구성 기록',
        '',
        `${today}부터 이 저장소는 Serverless Framework 패키지를 설치하지 않는다(lemon-templates-api \`v5\`와 같은 방식). 호출·로그·성능 점검·pack·배포 계획은 lemon-core의 \`lemon-*\` 명령이 맡는다([lambda-tools.md](lambda-tools.md)).`,
        '',
        '설정 파일은 남아 있다.',
        '',
        `-   ${
            ymls.map(f => `\`${f}\``).join(', ') || '`serverless.yml`'
        } — 함수·이벤트·환경 정의. \`lemon-*\` 도구도 \`serverless.yml\`의 \`service:\`와 http 이벤트를 읽는다. 로컬 서버(\`npm run express.lemon\`)의 라우트도 여기서 만든다.`,
        '-   `serverless.yml`의 `plugins:` 목록과 `env/`도 그대로다. 패키지가 없으면 `sls` 명령만 동작하지 않는다.',
        '-   `lemon` prod 배포는 오너가 별도로 처리한다(아래 구성을 다시 넣거나 배포 서비스로 옮긴다).',
        '',
        '## Serverless로 직접 배포·운영하려면',
        '',
        '아래는 지울 때의 구성이다. 이 저장소에서 마지막으로 동작한 조합이라 그대로 쓰기를 권한다.',
        '',
        '### devDependencies',
        '',
        '| 패키지 | 선언 범위 | 마지막 설치판 |',
        '| --- | --- | --- |',
        pkgRows,
        '',
        '```sh',
        installCmd,
        '```',
        '',
        '-   Serverless Framework 3.x 기준이다. 4.x는 로그인·라이선스 방식이 달라 이 저장소에서 검증하지 않았다.',
        `-   \`serverless-offline\`은 Node 22 이상에서 실패한다${
            removedPkgs.some(p => p.name === 'serverless-offline') ? '(선언돼 있었지만 위 설치 명령에서는 뺐다)' : ''
        }. 로컬 실행은 \`npm run express.lemon\`을 쓴다.`,
        '-   이 패키지들은 개발 전용이고, 설치하면 `npm audit`(전체) 경고가 늘어난다. `npm audit --omit=dev`는 그대로 0이다.',
        '',
        '### scripts',
        '',
        '`package.json`의 `scripts`에 다시 넣는다(지울 때의 원문). `deploy`·`remove`는 사람만 실행한다. 에이전트는 사람이 명시적으로 시킬 때만 돌린다.',
        '',
        '```json',
        ...(plain.length
            ? plain.map(s => `${JSON.stringify(s.key)}: ${JSON.stringify(s.value)},`)
            : ['// (sls 스크립트 없음)']),
        '```',
        '',
    ];
    if (guarded.length)
        lines.push(
            `-   \`lemon\` dev 스크립트(${guarded
                .map(s => `\`${s.key}\``)
                .join(
                    '·',
                )})는 다시 넣지 않는다. 지우기 전에도 가드(\`scripts/migrated-stage-guard.mjs\`, 함께 지움)로 막혀 있었다. 그 스택은 배포 서비스의 신규 설치(bootstrap, 2026-11)라 Serverless가 소유하면 안 된다.`,
        );
    if (offline.length)
        lines.push(
            `-   ${offline
                .map(s => `\`${s.key}\``)
                .join('·')}(\`sls offline\`)도 다시 넣지 않는다. 플러그인이 없어 지우기 전에도 동작하지 않았다.`,
        );
    lines.push(
        '',
        '## 대신 쓰는 명령',
        '',
        '| 예전 (`sls`) | 지금 |',
        '| --- | --- |',
        `| \`pack.*\` | \`npm run ${packScript}\` (\`lemon-lambda-pack\`) |`,
        `| \`deploy.lemon\` (dev) | \`npm run lambda:deploy\` (\`lemon-lambda-deploy\`, 기본은 계획만, \`--apply\`는 사람만)${
            hasDeployDev ? ' · 한 명령은 `npm run deploy:dev` (`bin/deploy-dev.sh`)' : ''
        } |`,
        '| `logs.*` | `npm run lambda:logs` (`lemon-lambda-logs`) |',
        '| `info.*` | `npm run lambda:invoke` (`lemon-lambda-invoke`)로 동작 확인 — 스택 정보 명령은 없다 |',
        '| `remove.*` | 대응 명령 없음 — 필요하면 위 구성으로 `sls`를 다시 설치한다 |',
        '| `server.*` | `npm run express.lemon` |',
        '',
    );
    ctx.write(item, path.join(ctx.target, 'docs/serverless.md'), lines.join('\n'), 'last Serverless setup recorded');
};

// ---------------------------------------------------------------------------------------------------------------------
// item: bin
// ---------------------------------------------------------------------------------------------------------------------
//* the README `deploy:dev` row per column count of the `npm run lambda:*` table (2 = templates, 3 = hello, 4 = with a source column).
const README_TEXT = '수동 dev 배포 한 명령(`bin/deploy-dev.sh`): pack → 계획 → `--apply` → GET `/`·`/hello/0` 확인';
const README_MORE =
    '기본 `dev`·`profile=lemon`, 설정 `.artifacts/deploy.code.dev.json`이 없으면 비공개 레인 폴더에서 한 번 만든다. `--plan-only`면 계획까지만. [docs/lambda-tools.md](docs/lambda-tools.md#manual-dev-deploy-bindeploy-devsh)';
const README_ROWS = {
    2: `| \`npm run deploy:dev\` | ${README_TEXT}. ${README_MORE} |`,
    3: `| \`npm run deploy:dev\` | ${README_TEXT} | ${README_MORE} |`,
    4: `| \`npm run deploy:dev\` | \`bin/deploy-dev.sh\` | ${README_TEXT} | ${README_MORE} |`,
};
//* the README `ship:check` row, same column variants (M2-P1; the recipe README row is the 3-column one).
const SHIP_TEXT =
    'push 전 유출 검사(`bin/ship-check.sh`, S3 게이트): 깨끗한 트리, 보호 파일(`env`·`serverless.yml`·`serverless-vpc.yml`) 무변경, diff 유출 패턴 0건, `version` 불변 또는 dev 형식 한 줄';
const SHIP_MORE =
    '읽기 전용, AWS 불필요. base 기본 `origin/v5`(`-- --base <ref>`). exit 0 통과·1 실패·2 사용법. 일치한 줄은 출력하지 않는다. [docs/lambda-tools.md](docs/lambda-tools.md#ship-check-binship-checksh)';
const README_SHIP_ROWS = {
    2: `| \`npm run ship:check\` | ${SHIP_TEXT}. ${SHIP_MORE} |`,
    3: `| \`npm run ship:check\` | ${SHIP_TEXT} | ${SHIP_MORE} |`,
    4: `| \`npm run ship:check\` | \`bin/ship-check.sh\` | ${SHIP_TEXT} | ${SHIP_MORE} |`,
};
//* the docs/lambda-tools.md scripts-table rows (4 columns = the recipe table, else the 3-column form).
const TOOLS_ROWS = {
    deploy: {
        4: '| `deploy:dev`        | `bin/deploy-dev.sh`       | Manual dev deploy: pack → plan → `--apply` → probe, in one command. Human-run only. | [Manual dev deploy](#manual-dev-deploy-bindeploy-devsh)      |',
        3: '| `deploy:dev`        | `bin/deploy-dev.sh`       | Manual dev deploy: pack → plan → `--apply` → probe, in one command. Human-run only ([Manual dev deploy](#manual-dev-deploy-bindeploy-devsh)). |',
    },
    ship: {
        4: '| `ship:check`        | `bin/ship-check.sh`       | Pre-ship leak check against a base ref: tree, protected files, leak scan, version.  | [Ship check](#ship-check-binship-checksh)                    |',
        3: '| `ship:check`        | `bin/ship-check.sh`       | Pre-ship leak check against a base ref: tree, protected files, leak scan, version. Read-only ([Ship check](#ship-check-binship-checksh)). |',
    },
};
//* section headings of the recipe docs/lambda-tools.md that the bin item ports.
const DEPLOY_HEADING = '### Manual dev deploy (`bin/deploy-dev.sh`)';
const SHIP_HEADING = '### Ship check (`bin/ship-check.sh`)';
//* a `### ` section of the recipe text: from its heading up to the next `## ` / `### ` heading (or the end).
const recipeSection = (src, heading) => {
    const start = src.indexOf(heading);
    if (start < 0) throw new Error(`recipe docs/lambda-tools.md has no section: ${heading}`);
    const m = /\n#{2,3} /.exec(src.slice(start + heading.length));
    return src.slice(start, m ? start + heading.length + m.index : src.length);
};
//* the line index right after the section that starts with `heading` (next `#`..`###` heading outside code fences), or -1.
const sectionEnd = (lines, heading) => {
    const start = lines.findIndex(l => l.startsWith(heading));
    if (start < 0) return -1;
    let fence = false;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^```/.test(lines[i])) fence = !fence;
        else if (!fence && /^#{1,3} /.test(lines[i])) return i;
    }
    return lines.length;
};
/**
 * add one script row (at the end of the scripts table = the one naming `lambda:invoke`) and one section to the
 * docs/lambda-tools.md lines. The section goes after `afterHeading`'s section when given and present, else before
 * `## What the tools read`, else at the end. Returns false when there is no scripts table (the section is still added).
 */
const addToolsEntry = (lines, rows, block, afterHeading) => {
    let rowAdded = false;
    const anchor = lines.findIndex(l => /^\|\s*`lambda:invoke`/.test(l));
    if (anchor >= 0) {
        // the table around the anchor; its header decides the row form
        let head = anchor;
        while (head > 0 && lines[head - 1].startsWith('|')) head--;
        let tail = anchor;
        while (tail + 1 < lines.length && lines[tail + 1].startsWith('|')) tail++;
        const cols = lines[head].split('|').length - 2;
        lines.splice(tail + 1, 0, cols >= 4 ? rows[4] : rows[3]);
        rowAdded = true;
    }
    // the section: next to its sibling section when there is one, else the B42 place
    const after = afterHeading ? sectionEnd(lines, afterHeading) : -1;
    const whatIdx = lines.findIndex(l => /^## What the tools read/.test(l));
    const body = block.replace(/\n*$/, '\n').split('\n');
    if (after >= 0) lines.splice(after, 0, ...body);
    else if (whatIdx >= 0) lines.splice(whatIdx, 0, ...body);
    else lines.push('', ...body);
    return rowAdded;
};
//* table cells of a markdown row (an escaped `\|` stays inside its cell).
const cellCount = line => line.split(/(?<!\\)\|/).length - 2;
/**
 * the README table to extend: of the `|` blocks whose rows run `npm run lambda:*`, the one with the most such rows.
 * returns the line index of its last `npm run lambda:*` row and the column count of its header, or null.
 */
const readmeLambdaRow = lines => {
    let best = null;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('|') || (i > 0 && lines[i - 1].startsWith('|'))) continue;
        // one table = consecutive `|` lines from here
        let j = i;
        while (j + 1 < lines.length && lines[j + 1].startsWith('|')) j++;
        const rows = [];
        for (let k = i; k <= j; k++) if (/\bnpm run lambda:/.test(lines[k])) rows.push(k);
        if (rows.length && (!best || rows.length > best.rows))
            best = { index: rows[rows.length - 1], cols: cellCount(lines[i]), rows: rows.length };
        i = j;
    }
    return best;
};

const runBin = ctx => {
    const item = 'bin';
    const name = ctx.name;
    ctx.copy(item, 'bin/deploy-dev.sh');
    // M2-P1: the S3 leak check (git only; reads the checkout it runs in, so it is copied verbatim too)
    ctx.copy(item, 'bin/ship-check.sh');
    if (!exists(path.join(ctx.target, 'deploy.config.example.json')))
        ctx.note(item, 'deploy.config.example.json missing — bin/deploy-dev.sh writes its first config from it');
    // scripts: `deploy:dev` next to the other lambda tools
    const pkgFile = path.join(ctx.target, 'package.json');
    const raw = read(pkgFile);
    const style = jsonStyle(raw);
    const pkg = ctx.pkg || JSON.parse(raw);
    if (pkg.scripts['deploy:dev'] !== 'bash bin/deploy-dev.sh') {
        const after = lastKey(pkg.scripts, k =>
            /^(lambda:|perf:lambda|fields:admin|loop:check|lambda:deploy:dev)/.test(k),
        );
        pkg.scripts = insertAfter(pkg.scripts, after, 'deploy:dev', 'bash bin/deploy-dev.sh');
        ctx.act(item, 'update', pkgFile, 'scripts: deploy:dev');
    }
    // scripts: `ship:check` right after `deploy:dev`
    if (pkg.scripts['ship:check'] !== 'bash bin/ship-check.sh') {
        pkg.scripts = insertAfter(pkg.scripts, 'deploy:dev', 'ship:check', 'bash bin/ship-check.sh');
        ctx.act(item, 'update', pkgFile, 'scripts: ship:check');
    }
    for (const s of ['pack', 'lambda:pack']) if (pkg.scripts[s]) break;
    if (!pkg.scripts.pack && !pkg.scripts['lambda:pack'])
        ctx.note(item, 'no pack / lambda:pack script — bin/deploy-dev.sh needs one');
    if (!pkg.scripts['lambda:deploy'] || !pkg.scripts['lambda:invoke'])
        ctx.note(item, 'lambda:deploy / lambda:invoke script missing — bin/deploy-dev.sh needs both');
    ctx.write(item, pkgFile, stringify(pkg, style));
    ctx.pkg = pkg;
    // .gitignore
    const gi = path.join(ctx.target, '.gitignore');
    let giTxt = exists(gi) ? read(gi) : '';
    const need = [
        ['.artifacts/', '# Verified Lambda ZIPs, deploy configs and receipts (npm run pack / deploy:dev)'],
        ['.pack-publish-*/', '# pack publish staging (lemon-lambda-pack --publish)'],
        ['.wt/', '# git worktrees of this repo (agent lanes)'],
        ['.claude/worktrees/', '# nested git worktrees of this repo (agent lanes)'],
    ];
    const missing = need.filter(([line]) => !giTxt.split('\n').some(l => l.trim() === line));
    if (missing.length) {
        giTxt =
            giTxt.replace(/\n*$/, '\n') +
            '\n' +
            missing.map(([line, c]) => (c ? `${c}\n${line}` : line)).join('\n') +
            '\n';
        ctx.write(item, gi, giTxt, `+${missing.map(m => m[0]).join(' ')}`);
    }
    // docs/lambda-tools.md: table row + section per script (from the recipe text, service name swapped), one write
    const tools = path.join(ctx.target, 'docs/lambda-tools.md');
    if (!exists(tools)) ctx.note(item, 'docs/lambda-tools.md missing — document deploy:dev and ship:check by hand');
    else {
        const srcTools = read(path.join(ctx.source, 'docs/lambda-tools.md'));
        const lines = read(tools).split('\n');
        const done = [];
        // deploy:dev (B42): the section text says `npm run pack`; a `lambda:pack` service gets its own script name
        if (!lines.join('\n').includes('bin/deploy-dev.sh')) {
            let section = recipeSection(srcTools, DEPLOY_HEADING).replace(/lemon-templates-api/g, name);
            const packScript = pkg.scripts.pack ? 'pack' : 'lambda:pack';
            if (packScript !== 'pack')
                section = section.replace('`npm run pack -- --output', '`npm run lambda:pack -- --output');
            if (!addToolsEntry(lines, TOOLS_ROWS.deploy, section, null))
                ctx.note(
                    item,
                    'docs/lambda-tools.md: no scripts table with `lambda:invoke` — add the deploy:dev row by hand',
                );
            done.push('deploy:dev row + section');
        }
        // ship:check (M2-P1): row after the deploy:dev row (end of the same table), section after the deploy:dev section
        if (!lines.join('\n').includes('bin/ship-check.sh')) {
            const section = recipeSection(srcTools, SHIP_HEADING).replace(/lemon-templates-api/g, name);
            if (!addToolsEntry(lines, TOOLS_ROWS.ship, section, DEPLOY_HEADING))
                ctx.note(
                    item,
                    'docs/lambda-tools.md: no scripts table with `lambda:invoke` — add the ship:check row by hand',
                );
            done.push('ship:check row + section');
        }
        if (done.length) ctx.write(item, tools, lines.join('\n'), done.join(', '));
    }
    // README: `deploy:dev` and `ship:check` rows in the table that lists `npm run lambda:*` rows (any header language, 2-4 columns)
    const readme = path.join(ctx.target, 'README.md');
    if (exists(readme)) {
        const lines = read(readme).split('\n');
        const done = [];
        //* a row naming `npm run deploy:dev` itself (`npm run lambda:deploy:dev` is another script).
        const hasRow = lines.some(l => l.startsWith('|') && /\bnpm run deploy:dev\b/.test(l));
        const at = hasRow ? null : readmeLambdaRow(lines);
        const row = at && README_ROWS[at.cols];
        if (row) {
            lines.splice(at.index + 1, 0, row);
            done.push(`deploy:dev row (${at.cols} columns)`);
        } else if (!hasRow)
            ctx.note(
                item,
                at
                    ? `README.md: the \`npm run lambda:*\` table has ${at.cols} columns — add the \`npm run deploy:dev\` (bin/deploy-dev.sh) row by hand`
                    : 'README.md: no `npm run lambda:*` table — add one line about `npm run deploy:dev` (bin/deploy-dev.sh) by hand',
            );
        // ship:check: same table, right after its `npm run deploy:dev` row, else at the end of the table
        const hasShip = lines.some(l => l.startsWith('|') && /\bnpm run ship:check\b/.test(l));
        const at2 = hasShip ? null : readmeLambdaRow(lines);
        const shipRow = at2 && README_SHIP_ROWS[at2.cols];
        if (shipRow) {
            // the table that holds the last `npm run lambda:*` row
            let end = at2.index;
            while (end + 1 < lines.length && lines[end + 1].startsWith('|')) end++;
            let start = at2.index;
            while (start > 0 && lines[start - 1].startsWith('|')) start--;
            let pos = end;
            for (let k = start; k <= end; k++) if (/\bnpm run deploy:dev\b/.test(lines[k])) pos = k;
            lines.splice(pos + 1, 0, shipRow);
            done.push(`ship:check row (${at2.cols} columns)`);
        } else if (!hasShip)
            ctx.note(
                item,
                at2
                    ? `README.md: the \`npm run lambda:*\` table has ${at2.cols} columns — add the \`npm run ship:check\` (bin/ship-check.sh) row by hand`
                    : 'README.md: no `npm run lambda:*` table — add one line about `npm run ship:check` (bin/ship-check.sh) by hand',
            );
        if (done.length) ctx.write(item, readme, lines.join('\n'), done.join(', '));
    }
};

// ---------------------------------------------------------------------------------------------------------------------
// item: types
// ---------------------------------------------------------------------------------------------------------------------
const runTypes = ctx => {
    const item = 'types';
    const typesDir = path.join(ctx.target, '@types');
    if (!exists(path.join(typesDir, 'package.json'))) {
        ctx.note(item, 'no @types/package.json — this service publishes no types package; item skipped');
        return;
    }
    // scripts copied verbatim (they resolve the service root from their own location)
    for (const f of ['rewrite-imports.ts', 'verify-types.ts', 'lemon-model-pair.ts']) ctx.copy(item, `@types/bin/${f}`);
    ctx.copy(item, '@types/tsconfig.verify.json');
    // init-package.ts: every service variant hard-codes `const MODEL_VERSION = '1.x.y'` (the stale-version bug);
    // the D107 patch replaces that constant with the installed pair. A file without the anchors is reported instead.
    const initFile = path.join(typesDir, 'bin/init-package.ts');
    const srcInit = read(path.join(ctx.source, '@types/bin/init-package.ts'));
    const IMPORT_LINE = "import $engine, { $U, ConfigService, SimpleSet, _inf, _log } from 'lemon-core';\n";
    const PAIR_IMPORT = "import { lemonModelPair } from './lemon-model-pair';\n";
    const CONST_RE = /^const MODEL_VERSION = '[^']*';\n/m;
    const PAIR_CONST =
        "//* the `lemon-model` that the installed lemon-core declares (its pair) - fails on a stale install (see lemon-model-pair.ts).\nconst MODEL_VERSION = lemonModelPair(path.resolve(__dirname, '..', '..')).modelVersion;\n";
    const DATE_LINE =
        ' * @date        2026-11-03 v5 D107: `lemon-model` version from the installed package (the pair of lemon-core), never `lemon-core`.\n';
    // D107 r3: a direct root `lemon-model` pin must also name the pair (verify (c) wants `^<installed>`) - every variant
    const PIN_OLD = "        else if (k == 'lemon-model') M['lemon-model'] = `${v}`;\n";
    const PIN_NEW =
        "        //* D107: a direct `lemon-model` pin also names the pair (verify-types (c) wants `^<installed>`).\n        else if (k == 'lemon-model') M['lemon-model'] = `^${MODEL_VERSION}`;\n";
    const pinPatch = txt => txt.replace(PIN_OLD, PIN_NEW);
    if (!exists(initFile)) ctx.copy(item, '@types/bin/init-package.ts');
    else if (read(initFile) === srcInit) {
        /* same as the recipe */
    } else if (read(initFile).includes('lemonModelPair')) {
        // already pair-based (B41 R2 / an earlier run): only the pin patch may still apply
        const txt = read(initFile);
        if (pinPatch(txt) !== txt)
            ctx.write(item, initFile, pinPatch(txt), 'D107 r3: direct lemon-model pin -> the pair');
    } else {
        let txt = read(initFile);
        const usesConst = CONST_RE.test(txt) && txt.includes('`^${MODEL_VERSION}`');
        const usesCoreRange = txt.includes("if (k == 'lemon-core') M['lemon-core'] = `${v}`;");
        if (!txt.includes(IMPORT_LINE) || !(usesConst || usesCoreRange)) {
            ctx.note(
                item,
                '@types/bin/init-package.ts: patch anchors not found — make `MODEL_VERSION` come from `lemonModelPair(...)` by hand (see the recipe)',
            );
        } else {
            // 1. import the pair resolver next to the lemon-core import
            txt = txt.replace(IMPORT_LINE, IMPORT_LINE + PAIR_IMPORT);
            // 2. the constant: drop the hard-coded one, define it after the lemon-core import (the `path` import must come first)
            if (usesConst)
                txt = txt
                    .replace(CONST_RE, '')
                    .replace('//! override environment.\n\n//! import statements', '//! import statements');
            txt = txt.replace(PAIR_IMPORT, PAIR_IMPORT + PAIR_CONST);
            // 3. the B16 variant still wrote the lemon-core range: write the lemon-model pair instead
            if (usesCoreRange)
                txt = txt.replace(
                    "        //* v5 B16: keep the parent's `lemon-core` range (no direct `lemon-model` any more).\n        if (k == 'lemon-core') M['lemon-core'] = `${v}`;\n",
                    "        if (k == 'lemon-core') M['lemon-model'] = `^${MODEL_VERSION}`;\n" + PIN_NEW,
                );
            txt = pinPatch(txt);
            // 4. header: one @date line after the last one
            const dates = [...txt.matchAll(/^ \* @date .*\n/gm)];
            if (dates.length) {
                const last = dates[dates.length - 1];
                txt = txt.slice(0, last.index + last[0].length) + DATE_LINE + txt.slice(last.index + last[0].length);
            }
            if (/MODEL_VERSION = '/.test(txt) || !txt.includes('`^${MODEL_VERSION}`'))
                ctx.note(item, '@types/bin/init-package.ts: patched, but check the MODEL_VERSION use by hand');
            ctx.write(item, initFile, txt, 'D107 patch: MODEL_VERSION from the installed lemon-model pair');
        }
    }
    // tsconfig.build.json: no incremental emit (the tsbuildinfo used to land in the tarball)
    const tsb = path.join(typesDir, 'tsconfig.build.json');
    if (exists(tsb)) {
        const raw = read(tsb);
        const cfg = JSON.parse(raw);
        cfg.compilerOptions = cfg.compilerOptions || {};
        if (cfg.compilerOptions.incremental !== false) {
            cfg.compilerOptions.incremental = false;
            ctx.write(item, tsb, stringify(cfg, jsonStyle(raw)), 'incremental: false');
        }
    } else
        ctx.note(
            item,
            "@types/tsconfig.build.json missing — copy the recipe file and set `include` to this service's type entry",
        );
    for (const f of walk(path.join(typesDir, 'dist'), ['.tsbuildinfo']))
        ctx.remove(item, f, 'stale incremental state (was tracked)');
    // scripts
    const pkgFile = path.join(ctx.target, 'package.json');
    const raw = read(pkgFile);
    const style = jsonStyle(raw);
    const pkg = ctx.pkg || JSON.parse(raw);
    const srcScripts = JSON.parse(read(path.join(ctx.source, 'package.json'))).scripts;
    const wantScripts = ['!types', 'prepretypes', 'pretypes', 'types', 'types:rewrite', 'types:verify', 'posttypes'];
    let changed = [];
    for (const k of wantScripts) {
        if (pkg.scripts[k] === srcScripts[k]) continue;
        if (!(k in pkg.scripts)) {
            const after =
                k === 'types:rewrite'
                    ? 'types'
                    : k === 'types:verify'
                    ? 'types:rewrite'
                    : lastKey(pkg.scripts, x => wantScripts.includes(x));
            pkg.scripts = insertAfter(pkg.scripts, after, k, srcScripts[k]);
        } else pkg.scripts[k] = srcScripts[k];
        changed.push(k);
    }
    if (changed.length) ctx.act(item, 'update', pkgFile, `scripts: ${changed.join(', ')}`);
    ctx.write(item, pkgFile, stringify(pkg, style));
    ctx.pkg = pkg;
    // eslint: lint @types/dist with the reverse rule
    const ignore = path.join(ctx.target, '.eslintignore');
    if (exists(ignore)) {
        const txt = read(ignore)
            .split('\n')
            .filter(l => l.trim() !== '@types/dist/*' && l.trim() !== '@types/dist')
            .join('\n');
        ctx.write(item, ignore, txt, '@types/dist is linted now');
    }
    const rc = path.join(ctx.target, '.eslintrc.js');
    if (exists(rc)) {
        const txt = read(rc);
        const src = read(path.join(ctx.source, '.eslintrc.js'));
        const start = src.indexOf('    //* v5 D107');
        const end = src.lastIndexOf('};');
        const block = src.slice(start, end); // "    //* v5 D107 ...\n    overrides: [\n        { ... },\n    ],\n"
        if (txt.includes("files: ['@types/dist/**/*.d.ts']")) {
            /* already there */
        } else if (start < 0) ctx.note(item, '.eslintrc.js: recipe block not found — add the overrides by hand');
        else if (/overrides\s*:\s*\[/.test(txt)) {
            // an `overrides` array exists: put the recipe's entry object first in it
            const entryStart = block.indexOf('        {');
            const entryEnd = block.lastIndexOf('    ],');
            const entry = block.slice(entryStart, entryEnd); // the one entry object, with its trailing comma and newline
            const comment = block.slice(0, block.indexOf('\n') + 1); // the D107 comment line
            const m = /overrides\s*:\s*\[\n?/.exec(txt);
            const lineStart = txt.lastIndexOf('\n', m.index) + 1; // the comment goes on its own line above `overrides:`, same indentation
            const at = m.index + m[0].length;
            const out =
                txt.slice(0, lineStart) +
                comment +
                txt.slice(lineStart, at) +
                (m[0].endsWith('\n') ? '' : '\n') +
                entry +
                txt.slice(at);
            ctx.write(item, rc, out, 'overrides: @types/dist entry added to the existing array');
        } else {
            const closing = txt.lastIndexOf('};');
            if (closing < 0) ctx.note(item, '.eslintrc.js: closing `};` not found — add the overrides by hand');
            else {
                // the `rules` object must end with a comma before the new key
                let before = txt.slice(0, closing).replace(/\s*$/, '\n');
                if (/\}\n$/.test(before)) before = before.replace(/\}\n$/, '},\n');
                ctx.write(
                    item,
                    rc,
                    before + block + txt.slice(closing),
                    'overrides: @types/dist names lemon-model only',
                );
            }
        }
    } else ctx.note(item, '.eslintrc.js missing — the D107 eslint override is not installed');
    // @types/README.md: the H1 is the package name
    const rd = path.join(typesDir, 'README.md');
    if (exists(rd)) {
        const txt = read(rd);
        const fixed = txt.replace(/^# @lemoncloud\/[^\n]+/, `# @lemoncloud/${ctx.name}`);
        ctx.write(item, rd, fixed, 'H1 = package name');
    }
    ctx.note(
        item,
        'after `npm install`: `npm run types` regenerates @types/package.json (lemon-model pair) and @types/dist — commit both',
    );
};

// ---------------------------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------------------------
const main = () => {
    const opt = parseArgs(process.argv.slice(2));
    if (
        !exists(path.join(opt.source, 'bin/deploy-dev.sh')) ||
        !exists(path.join(opt.source, '@types/bin/verify-types.ts'))
    )
        throw new Error(`--source ${opt.source} is not a lemon-templates-api v5 checkout`);
    const report = { source: opt.source, apply: opt.apply, targets: [] };
    for (const target of opt.targets) {
        if (!exists(path.join(target, 'package.json'))) throw new Error(`not a service checkout: ${target}`);
        const ctx = makeCtx(target, opt.source, opt.apply);
        ctx.name = JSON.parse(read(path.join(target, 'package.json'))).name;
        if (
            ctx.name === JSON.parse(read(path.join(opt.source, 'package.json'))).name &&
            path.resolve(target) === path.resolve(opt.source)
        )
            throw new Error('target is the recipe itself');
        if (opt.only.includes('pkg')) runPkg(ctx, opt);
        if (opt.only.includes('bin')) runBin(ctx);
        if (opt.only.includes('types')) runTypes(ctx);
        // dedupe repeated rows; the bare "package.json written" row is implied by the detailed ones
        const seen = new Set();
        const detailed = new Set(ctx.actions.filter(a => a.note).map(a => a.file));
        const actions = ctx.actions.filter(a => {
            if (!a.note && detailed.has(a.file)) return false;
            const k = `${a.item}|${a.kind}|${a.file}|${a.note}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        report.targets.push({ target, name: ctx.name, sls: ctx.sls, actions, notes: ctx.notes, owner: ctx.owner });
        // text report
        console.log(`\n== ${ctx.name} (${target}) ${opt.apply ? '[applied]' : '[dry-run]'}`);
        if (ctx.sls)
            console.log(
                `   serverless: ${ctx.sls.mode}${
                    ctx.sls.foreign.length ? ` (other profiles: ${ctx.sls.foreign.join(', ')})` : ''
                } — ${ctx.sls.packages} package(s), ${ctx.sls.scripts} script(s)`,
            );
        for (const a of actions)
            console.log(`   ${a.kind.padEnd(6)} ${a.item.padEnd(5)} ${a.file}${a.note ? ` — ${a.note}` : ''}`);
        for (const n of ctx.notes) console.log(`   note   ${n.item.padEnd(5)} ${n.text}`);
        for (const o of ctx.owner) console.log(`   OWNER  ${o.item.padEnd(5)} ${o.text}`);
        if (!actions.length) console.log('   (nothing to change)');
    }
    if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(report, null, 2) + '\n');
    console.log(
        `\nnext: ${
            opt.apply ? '' : '(after --apply) '
        }npm install → npm run build && npx tsc --noEmit && npx eslint . --ext .ts → npm test → npm run types → git diff`,
    );
};

try {
    main();
} catch (e) {
    console.error(`[sync-v5-tooling] ERROR: ${e.message}`);
    process.exit(2);
}
