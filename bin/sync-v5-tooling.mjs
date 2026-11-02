#!/usr/bin/env node
/**
 * `bin/sync-v5-tooling.mjs` — port the v5 tooling of this repository (the recipe) into other v5 service checkouts.
 *
 * Items (`--only` picks a subset):
 *  - `pkg`   : Serverless Framework removal (packages, `sls` scripts, dev guard, docs/serverless.md record),
 *              deepmerge-safe + minimatch / test-exclude overrides, lemon-core and nodemon floors,
 *              unused dev deps (codecov, typedoc, @types/cors|request|uuid) when nothing uses them.
 *  - `bin`   : `bin/deploy-dev.sh` + `npm run deploy:dev`, `.gitignore` entries, docs/lambda-tools.md and README rows.
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
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import fs from 'fs';
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
const runBin = ctx => {
    const item = 'bin';
    const name = ctx.name;
    ctx.copy(item, 'bin/deploy-dev.sh');
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
    // docs/lambda-tools.md: table row + section (from the recipe text, service name swapped)
    const tools = path.join(ctx.target, 'docs/lambda-tools.md');
    if (!exists(tools)) ctx.note(item, 'docs/lambda-tools.md missing — document deploy:dev by hand');
    else if (!read(tools).includes('bin/deploy-dev.sh')) {
        const srcTools = read(path.join(ctx.source, 'docs/lambda-tools.md'));
        const secStart = srcTools.indexOf('### Manual dev deploy (`bin/deploy-dev.sh`)');
        const secEnd = srcTools.indexOf('\n## ', secStart);
        let section = srcTools.slice(secStart, secEnd).replace(/lemon-templates-api/g, name);
        const packScript = pkg.scripts.pack ? 'pack' : 'lambda:pack';
        if (packScript !== 'pack')
            section = section.replace('`npm run pack -- --output', '`npm run lambda:pack -- --output');
        const lines = read(tools).split('\n');
        // the scripts table = the one whose rows name `lambda:invoke`
        const anchor = lines.findIndex(l => /^\|\s*`lambda:invoke`/.test(l));
        if (anchor >= 0) {
            let head = anchor;
            while (head > 0 && lines[head - 1].startsWith('|')) head--;
            let tail = anchor;
            while (tail + 1 < lines.length && lines[tail + 1].startsWith('|')) tail++;
            const cols = lines[head].split('|').length - 2;
            const row =
                cols >= 4
                    ? '| `deploy:dev`        | `bin/deploy-dev.sh`       | Manual dev deploy: pack → plan → `--apply` → probe, in one command. Human-run only. | [Manual dev deploy](#manual-dev-deploy-bindeploy-devsh)      |'
                    : '| `deploy:dev`        | `bin/deploy-dev.sh`       | Manual dev deploy: pack → plan → `--apply` → probe, in one command. Human-run only ([Manual dev deploy](#manual-dev-deploy-bindeploy-devsh)). |';
            lines.splice(tail + 1, 0, row);
        } else
            ctx.note(
                item,
                'docs/lambda-tools.md: no scripts table with `lambda:invoke` — add the deploy:dev row by hand',
            );
        const whatIdx = lines.findIndex(l => /^## What the tools read/.test(l));
        const block = section.replace(/\n*$/, '\n');
        if (whatIdx >= 0) lines.splice(whatIdx, 0, ...block.split('\n'));
        else lines.push('', ...block.split('\n'));
        ctx.write(item, tools, lines.join('\n'), 'deploy:dev row + section');
    }
    // README: a row after the `lambda:migrate` row when the README has that table
    const readme = path.join(ctx.target, 'README.md');
    if (exists(readme) && !read(readme).includes('deploy:dev')) {
        const lines = read(readme).split('\n');
        const idx = lines.findIndex(l => /^\|\s*`npm run lambda:(migrate|deploy)/.test(l));
        if (idx >= 0) {
            const cols = lines[idx].split('|').length - 2;
            const row =
                cols >= 3
                    ? '| `npm run deploy:dev` | 수동 dev 배포 한 명령(`bin/deploy-dev.sh`): pack → 계획 → `--apply` → GET `/`·`/hello/0` 확인 | 기본 `dev`·`profile=lemon`, 설정 `.artifacts/deploy.code.dev.json`이 없으면 비공개 레인 폴더에서 한 번 만든다. `--plan-only`면 계획까지만. [docs/lambda-tools.md](docs/lambda-tools.md#manual-dev-deploy-bindeploy-devsh) |'
                    : '| `npm run deploy:dev` | 수동 dev 배포 한 명령(`bin/deploy-dev.sh`): pack → 계획 → `--apply` → GET `/`·`/hello/0` 확인. 기본 `dev`·`profile=lemon`, 설정 `.artifacts/deploy.code.dev.json`이 없으면 비공개 레인 폴더에서 한 번 만든다. `--plan-only`면 계획까지만. [docs/lambda-tools.md](docs/lambda-tools.md#manual-dev-deploy-bindeploy-devsh) |';
            // keep the row inside the table: skip following rows of the same table
            let at = idx;
            while (at + 1 < lines.length && lines[at + 1].startsWith('|')) at++;
            lines.splice(at + 1, 0, row);
            ctx.write(item, readme, lines.join('\n'), 'deploy:dev row');
        } else
            ctx.note(
                item,
                'README.md: no `npm run lambda:*` table — add one line about `npm run deploy:dev` (bin/deploy-dev.sh) by hand',
            );
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
