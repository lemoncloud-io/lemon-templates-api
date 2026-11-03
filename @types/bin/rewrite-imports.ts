/**
 * `bin/rewrite-imports.ts`
 * - rewrite the emitted `@types/dist/**\/*.d.ts` to reach the model types through `lemon-model` only.
 * - the service source imports them from `lemon-core` (root, v5 B16/D73), but the types package must not name `lemon-core`.
 * - `lemon-core` and `lemon-core/model` become `lemon-model`; any other `lemon-core/...` subpath fails (fix the type source).
 *
 * ```sh
 * $ npm run types:rewrite     # run by `npm run types`, after the emit and before `types:verify`
 * ```
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-11-03 v5 D107: initial version, ported from eureka-cognitos-api B41 R2 (the `@types` package names `lemon-model` only).
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import path from 'path';
import fs from 'fs';
import ts from 'typescript';

//* the folder of the emitted declarations.
const DIST = path.resolve(__dirname, '..', 'dist');
//* module names rewritten to `lemon-model` (the model types lemon-core re-exports).
const REWRITE = ['lemon-core', 'lemon-core/model'];
const TARGET = 'lemon-model';

//* list every `.d.ts` under the folder (recursive).
const listDts = (dir: string): string[] =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap(e =>
            e.isDirectory()
                ? listDts(path.join(dir, e.name))
                : e.name.endsWith('.d.ts')
                ? [path.join(dir, e.name)]
                : [],
        );

//* the module specifiers of a file: import / export-from / `import()` / `require()` / `/// <reference types>`.
const specifiersOf = (text: string) => {
    const info = ts.preProcessFile(text, true, true);
    return [...info.importedFiles, ...info.typeReferenceDirectives];
};

//* rewrite one file; returns the rewritten names, and the `lemon-core/...` subpaths it cannot rewrite.
const rewriteFile = (file: string) => {
    const text = fs.readFileSync(file, 'utf8');
    const refs = specifiersOf(text).filter(r => r.fileName === 'lemon-core' || r.fileName.startsWith('lemon-core/'));
    const blocked = refs.filter(r => !REWRITE.includes(r.fileName)).map(r => r.fileName);
    if (blocked.length) return { changed: 0, blocked };
    //* replace from the end, so the earlier positions stay valid (`pos` is at the opening quote, so find the name from there).
    const out = [...refs]
        .sort((a, b) => b.pos - a.pos)
        .reduce((s, r) => {
            const at = s.indexOf(r.fileName, r.pos);
            if (at < 0 || at > r.pos + 1) throw new Error(`@pos[${r.pos}] '${r.fileName}' not found - ${file}`);
            return s.slice(0, at) + TARGET + s.slice(at + r.fileName.length);
        }, text);
    if (out !== text) fs.writeFileSync(file, out);
    return { changed: refs.length, blocked };
};

//* main: rewrite all, then fail if any file holds a subpath that has no `lemon-model` counterpart.
const main = () => {
    if (!fs.existsSync(DIST)) throw new Error(`@types/dist is missing - run the emit first (npm run types)`);
    const files = listDts(DIST);
    let changed = 0;
    const failures: string[] = [];
    files.forEach(file => {
        const res = rewriteFile(file);
        changed += res.changed;
        res.blocked.forEach(name => failures.push(`${path.relative(DIST, file)}: '${name}'`));
    });
    console.info(`[rewrite-imports] ${files.length} d.ts, ${changed} specifier(s) -> '${TARGET}'`);
    if (failures.length) {
        console.error(
            `[rewrite-imports] FAIL: lemon-core subpath(s) with no lemon-model counterpart (fix the type source):`,
        );
        failures.forEach(f => console.error(`  - ${f}`));
        process.exit(1);
    }
};
main();
