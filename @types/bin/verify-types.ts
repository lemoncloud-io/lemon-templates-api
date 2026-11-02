/**
 * `bin/verify-types.ts`
 * - verify the `@types` package names `lemon-model` only, never `lemon-core` (owner decision 2026-11-03).
 * - (a) every module specifier in `dist/**\/*.d.ts` is relative, `lemon-model` or `@lemoncloud/*`, and no `lemon-core` text at all (comments too);
 *   and `dist` holds `.d.ts` files only (a `tsbuildinfo` would carry `lemon-core` paths into the published package).
 * - (b) the declarations type-check alone (`tsconfig.verify.json`): every name taken from `lemon-model` exists there (no TS2305/TS2307/TS2724).
 * - (c) `package.json` depends on `lemon-model` / `@lemoncloud/*` only, `lemon-model` is `^<installed>`, name and version follow the service.
 *
 * ```sh
 * $ npm run types:verify      # also the last step of `npm run types`
 * ```
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-11-03 v5 D107: initial version, ported from eureka-cognitos-api B41 R2.
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import path from 'path';
import fs from 'fs';
import ts from 'typescript';

//* paths of the types package and of the service.
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SERVICE = path.resolve(ROOT, '..');
//* the diagnostics of a missing module or a missing exported name.
const MISSING_CODES = [2305, 2307, 2724];

//* json loader.
const loadJson = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));

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

//* list every file under the folder that is not a `.d.ts` (recursive) - nothing else belongs in `dist`.
const listOthers = (dir: string): string[] =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap(e =>
            e.isDirectory()
                ? listOthers(path.join(dir, e.name))
                : e.name.endsWith('.d.ts')
                ? []
                : [path.join(dir, e.name)],
        );

//* allowed module: relative, `lemon-model` (exact), or `@lemoncloud/*`.
const isAllowed = (name: string) => name.startsWith('.') || name === 'lemon-model' || name.startsWith('@lemoncloud/');

//* (a) module specifiers and `lemon-core` text; also returns the `lemon-model` names per file for the report.
const checkSpecifiers = (files: string[], errors: string[]) => {
    const imports: { [module: string]: Set<string> } = {};
    files.forEach(file => {
        const rel = path.relative(ROOT, file);
        const text = fs.readFileSync(file, 'utf8');
        //* any `lemon-core` text fails, even in a comment.
        text.split('\n').forEach((line, i) => {
            if (line.includes('lemon-core')) errors.push(`(a) ${rel}:${i + 1}: 'lemon-core' text - ${line.trim()}`);
        });
        //* every module specifier must be allowed.
        const info = ts.preProcessFile(text, true, true);
        [...info.importedFiles, ...info.typeReferenceDirectives].forEach(r => {
            if (!isAllowed(r.fileName)) errors.push(`(a) ${rel}: module '${r.fileName}' is not allowed`);
        });
        //* collect imported names of the non-relative modules (report only).
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
        sf.statements.forEach(st => {
            if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) return;
            const mod = st.moduleSpecifier.text;
            if (mod.startsWith('.')) return;
            const set = (imports[mod] = imports[mod] || new Set<string>());
            const bind = st.importClause?.namedBindings;
            if (st.importClause?.name) set.add(`default as ${st.importClause.name.text}`);
            if (bind && ts.isNamedImports(bind)) bind.elements.forEach(e => set.add(e.name.text));
            if (bind && ts.isNamespaceImport(bind)) set.add(`* as ${bind.name.text}`);
        });
    });
    return imports;
};

//* (b) type-check the declarations alone; any diagnostic in `dist`, or a missing module/name anywhere, fails.
const checkTypes = (errors: string[]) => {
    const configFile = path.join(ROOT, 'tsconfig.verify.json');
    const parsed = ts.getParsedCommandLineOfConfigFile(
        configFile,
        {},
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: d =>
                errors.push(`(b) ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`),
        },
    );
    if (!parsed) return 0;
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const diags = ts.getPreEmitDiagnostics(program);
    const notes: string[] = [];
    diags.forEach(d => {
        const file = d.file ? path.relative(SERVICE, d.file.fileName) : '';
        const inDist = !!d.file && d.file.fileName.startsWith(DIST);
        const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
        const msg = `TS${d.code} ${file}:${line} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
        if (inDist || MISSING_CODES.includes(d.code)) errors.push(`(b) ${msg}`);
        else notes.push(msg);
    });
    //* other diagnostics inside the installed packages are theirs, so only counted (listed with VERBOSE=1).
    if (notes.length)
        console.warn(`[verify-types] (b) ${notes.length} note(s) outside dist (installed packages, not failing)`);
    if (process.env.VERBOSE) notes.forEach(n => console.warn(`  . ${n}`));
    return parsed.fileNames.length;
};

//* (c) the package.json of the types package.
const checkPackage = (errors: string[]) => {
    const $svc = loadJson(path.join(SERVICE, 'package.json'));
    const $pkg = loadJson(path.join(ROOT, 'package.json'));
    const modelVersion = loadJson(require.resolve('lemon-model/package.json', { paths: [SERVICE] })).version;
    const deps: { [k: string]: string } = $pkg.dependencies || {};
    Object.keys(deps).forEach(k => {
        if (k !== 'lemon-model' && !k.startsWith('@lemoncloud/')) errors.push(`(c) dependency '${k}' is not allowed`);
    });
    if (deps['lemon-model'] !== `^${modelVersion}`)
        errors.push(`(c) lemon-model '${deps['lemon-model'] ?? ''}' != '^${modelVersion}' (installed)`);
    if ($pkg.name !== `@lemoncloud/${$svc.name}`) errors.push(`(c) name '${$pkg.name}' != '@lemoncloud/${$svc.name}'`);
    if ($pkg.version !== $svc.version) errors.push(`(c) version '${$pkg.version}' != '${$svc.version}'`);
    if (!fs.existsSync(path.join(ROOT, $pkg.types || ''))) errors.push(`(c) types entry '${$pkg.types}' is missing`);
    return { name: $pkg.name, version: $pkg.version, deps };
};

//* main: run (a)(b)(c), print the import list, and exit 1 on any error.
const main = () => {
    const errors: string[] = [];
    if (!fs.existsSync(DIST)) throw new Error(`@types/dist is missing - run: npm run types`);
    const files = listDts(DIST);
    //* (a) only declarations are published from `dist`.
    listOthers(DIST).forEach(f =>
        errors.push(`(a) ${path.relative(ROOT, f)}: not a .d.ts - dist holds declarations only`),
    );
    const imports = checkSpecifiers(files, errors);
    const checked = checkTypes(errors);
    const pkg = checkPackage(errors);
    console.info(`[verify-types] ${pkg.name}@${pkg.version} deps=${JSON.stringify(pkg.deps)}`);
    console.info(`[verify-types] ${files.length} d.ts, ${checked} file(s) type-checked`);
    Object.entries(imports).forEach(([mod, names]) =>
        console.info(`[verify-types] import '${mod}': ${[...names].sort().join(', ')}`),
    );
    if (errors.length) {
        console.error(`[verify-types] FAIL (${errors.length}):`);
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
    }
    console.info(`[verify-types] OK - lemon-core 0, modules allowed, lemon-model names resolved, package.json in sync`);
};
main();
