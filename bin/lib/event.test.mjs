/**
 * `bin/lib/event.test.mjs`
 * - offline tests for the web event builder in `event.mjs` and the `--internal` / `--identity` options.
 * - run: `npm run lambda:test`
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webEvent, toRoute, checkWebOptions, eventLabel, parseIdentity, IDENTITY_WARNING } from './event.mjs';
import { maskHeaders, ArgError } from './common.mjs';

// the invoke script, run with `--dry` only (no AWS call).
const SCRIPT = fileURLToPath(new URL('../lambda-invoke.mjs', import.meta.url));

// run the invoke script offline and return `{ status, stdout, stderr }`.
const dry = args => spawnSync(process.execPath, [SCRIPT, ...args, '--dry'], { encoding: 'utf8' });

// assert that `fn` throws an `ArgError` (code 2) whose message matches `re`.
const throwsArg = (fn, re) =>
    assert.throws(fn, e => e instanceof ArgError && e.code === 2 && re.test(e.message), `expected ArgError ${re}`);

// header names of one header map, lower-cased.
const names = H => Object.keys(H).map(k => k.toLowerCase());

describe('web event', () => {
    test('default event has `Host: localhost` in both header maps', () => {
        const ev = webEvent({ path: '/hello/0' }, 'dev');
        assert.equal(ev.headers.Host, 'localhost');
        assert.deepEqual(ev.multiValueHeaders.Host, ['localhost']);
        assert.equal(ev.requestContext.domainName, undefined);
        assert.equal(eventLabel('web', {}), 'web');
    });
    test('toRoute maps `/{type}/{id}/{cmd}`', () => {
        assert.deepEqual(toRoute('/'), { resource: '/', pathParameters: null });
        assert.deepEqual(toRoute('/hello/0'), { resource: '/hello/{id}', pathParameters: { id: '0' } });
        assert.deepEqual(toRoute('/mocks/fields/admin'), {
            resource: '/mocks/{id}/{cmd}',
            pathParameters: { id: 'fields', cmd: 'admin' },
        });
    });
    test('`--internal` drops every host header and keeps the rest', () => {
        const base = webEvent({ path: '/mocks/fields/admin' }, 'dev');
        const ev = webEvent({ path: '/mocks/fields/admin', internal: true, header: ['host:x'] }, 'dev');
        assert.ok(!names(ev.headers).includes('host'));
        assert.ok(!names(ev.multiValueHeaders).includes('host'));
        assert.equal(ev.requestContext.domainName, undefined);
        // everything but the host header stays.
        const { Host, ...rest } = base.headers;
        assert.equal(Host, 'localhost');
        assert.deepEqual(ev.headers, rest);
        assert.equal(ev.resource, base.resource);
        assert.equal(eventLabel('web', { internal: true }), 'web(internal)');
    });
    test('`--identity` sets x-lemon-identity verbatim and is masked for echo', () => {
        const id = '{"sid":"s1", "uid":"u1"}';
        const ev = webEvent({ path: '/x', internal: true, identity: id }, 'dev');
        assert.equal(ev.headers['x-lemon-identity'], id);
        assert.deepEqual(ev.multiValueHeaders['x-lemon-identity'], [id]);
        const masked = maskHeaders(ev);
        assert.equal(masked.headers['x-lemon-identity'], '<redacted>');
        assert.deepEqual(masked.multiValueHeaders['x-lemon-identity'], ['<redacted>']);
    });
    test('invalid `--identity` JSON is an ArgError (code 2)', () => {
        throwsArg(() => parseIdentity('{bad'), /^--identity is not valid JSON$/);
        throwsArg(() => parseIdentity(true), /--identity needs a JSON string/);
        throwsArg(() => webEvent({ identity: '{bad' }, 'dev'), /not valid JSON/);
        assert.equal(parseIdentity(undefined), undefined);
    });
    test('web-only options with another event kind are errors', () => {
        throwsArg(() => checkWebOptions('cron', { internal: true }), /^--internal applies to --event web only$/);
        throwsArg(() => checkWebOptions('sns', { identity: '{}' }), /^--identity applies to --event web only$/);
        assert.deepEqual(checkWebOptions('cron', {}), []);
    });
    test('`--identity` without `--internal` warns', () => {
        assert.deepEqual(checkWebOptions('web', { identity: '{}' }), [IDENTITY_WARNING]);
        assert.deepEqual(checkWebOptions('web', { identity: '{}', internal: true }), []);
    });
});

describe('lambda-invoke --dry', () => {
    test('`--internal --identity` passes strict options; no host key, identity masked', () => {
        const r = dry(['--internal', '--path', '/mocks/fields/admin', '--identity', '{"sid":"s1"}']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout.split('\n')[0], / event=web\(internal\) GET \/mocks\/fields\/admin /);
        assert.doesNotMatch(r.stdout, /"host"/i);
        assert.doesNotMatch(r.stdout, /s1/);
        assert.match(r.stdout, /"x-lemon-identity": "<redacted>"/);
        assert.equal(r.stderr, '');
    });
    test('`--identity` alone warns on stderr and continues', () => {
        const r = dry(['--identity', '{}']);
        assert.equal(r.status, 0);
        assert.equal(r.stderr.trim(), IDENTITY_WARNING);
        assert.match(r.stdout, /"Host": "localhost"/);
    });
    test('bad uses exit 2', () => {
        const cron = dry(['--internal', '--event', 'cron']);
        assert.equal(cron.status, 2);
        assert.equal(cron.stderr.trim(), 'ERROR: --internal applies to --event web only');
        const bad = dry(['--identity', '{bad']);
        assert.equal(bad.status, 2);
        assert.equal(bad.stderr.trim(), 'ERROR: --identity is not valid JSON');
    });
});
