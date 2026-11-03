/**
 * `test/ship-check.spec.ts` — scenarios of `bin/ship-check.sh` on throw-away git repositories.
 *
 * Each case builds a repository under the OS temp folder with a `base` branch, changes something,
 * then runs `bash bin/ship-check.sh --base base` there and checks the exit code and the PASS / FAIL lines.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-11-03 v5 M2-P1: initial version.
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

//* the script under test, from this checkout.
const SCRIPT = path.resolve(__dirname, '..', 'bin', 'ship-check.sh');
//* git without the machine's global / system config (no hooks, no signing, no default branch hints).
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
//* a 12-digit number built at run time, so this file itself holds no such literal.
const TWELVE = '4'.repeat(6) + '7'.repeat(6);

describe('bin/ship-check.sh', () => {
    //* one temp folder for every repository of this file; removed at the end.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-check-'));
    let seq = 0;

    afterAll(() => {
        // remove only what this file created under the OS temp folder
        if (root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true });
    });

    //* run git in a repository (author set on the command line).
    const git = (cwd: string, ...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd, env: ENV, stdio: 'pipe' });

    //* write a file (folders created) inside a repository.
    const put = (cwd: string, rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
        fs.writeFileSync(path.join(cwd, rel), text);
    };

    //* package.json text with the given version on its own line.
    const pkg = (version: string) => JSON.stringify({ name: 'x', version, private: true }, null, 2) + '\n';

    //* a new repository: one commit on `main`, branch `base` at that commit.
    const makeRepo = () => {
        const cwd = path.join(root, `repo-${++seq}`);
        fs.mkdirSync(cwd);
        git(cwd, 'init', '-q', '-b', 'main');
        put(cwd, 'package.json', pkg('5.26.1102a'));
        put(cwd, 'README.md', '# x\n');
        put(cwd, 'env/x.yml', 'a: 1\n');
        git(cwd, 'add', '-A');
        git(cwd, 'commit', '-q', '-m', 'init');
        git(cwd, 'branch', 'base');
        return cwd;
    };

    //* commit every change in the repository.
    const commitAll = (cwd: string, msg: string) => {
        git(cwd, 'add', '-A');
        git(cwd, 'commit', '-q', '-m', msg);
    };

    //* run the script in the repository; extra args replace the default `--base base`.
    const run = (cwd: string, args: string[] = ['--base', 'base']) => {
        const r = spawnSync('bash', [SCRIPT, ...args], { cwd, env: ENV, encoding: 'utf8' });
        return { code: r.status, out: r.stdout, err: r.stderr };
    };

    it('(a) clean tree, no change -> exit 0, four PASS lines', () => {
        const cwd = makeRepo();
        const r = run(cwd);
        expect(r.code).toBe(0);
        for (const name of ['tree', 'protected', 'leak-scan', 'version'])
            expect(r.out).toContain(`[ship-check] PASS ${name} — `);
        expect(r.out).toContain('[ship-check] PASS all 4 checks');
    });

    it('(b) tracked file changed but not committed -> exit 1, tree FAIL', () => {
        const cwd = makeRepo();
        put(cwd, 'README.md', '# x\nmore\n');
        const r = run(cwd);
        expect(r.code).toBe(1);
        expect(r.out).toContain('[ship-check] FAIL tree — 1 path(s) not committed: README.md');
        expect(r.out).toContain('[ship-check] FAIL 1 of 4 checks');
    });

    it('(c) env file change committed -> exit 1, protected FAIL, content not printed', () => {
        const cwd = makeRepo();
        put(cwd, 'env/x.yml', 'a: changed-value\n');
        commitAll(cwd, 'env');
        const r = run(cwd);
        expect(r.code).toBe(1);
        expect(r.out).toContain('[ship-check] FAIL protected — 1 file(s) changed: env/x.yml');
        expect(r.out + r.err).not.toContain('changed-value');
    });

    it('(d) 12-digit number committed -> exit 1, leak-scan FAIL, the number never printed', () => {
        const cwd = makeRepo();
        put(cwd, 'notes.txt', `id ${TWELVE}\n`);
        commitAll(cwd, 'notes');
        const r = run(cwd);
        expect(r.code).toBe(1);
        expect(r.out).toContain('[ship-check] FAIL leak-scan — 1 matching line(s) in 1 file(s): notes.txt');
        expect(r.out).not.toContain(TWELVE);
        expect(r.err).not.toContain(TWELVE);
    });

    it('(e) version bumped to the dev form 5.26.1103a -> exit 0', () => {
        const cwd = makeRepo();
        put(cwd, 'package.json', pkg('5.26.1103a'));
        commitAll(cwd, 'bump');
        const r = run(cwd);
        expect(r.code).toBe(0);
        expect(r.out).toContain('[ship-check] PASS version — 5.26.1102a -> 5.26.1103a (dev form)');
    });

    it('(f) version 5.1.0 (not the dev form) -> exit 1, version FAIL', () => {
        const cwd = makeRepo();
        put(cwd, 'package.json', pkg('5.1.0'));
        commitAll(cwd, 'bump');
        const r = run(cwd);
        expect(r.code).toBe(1);
        expect(r.out).toContain('[ship-check] FAIL version — 5.26.1102a -> 5.1.0 is not the dev form');
    });

    it('(g) unknown base ref -> exit 2', () => {
        const cwd = makeRepo();
        const r = run(cwd, ['--base', 'nope']);
        expect(r.code).toBe(2);
        expect(r.err).toContain('[ship-check] ERROR: base ref not found: nope');
    });
});
