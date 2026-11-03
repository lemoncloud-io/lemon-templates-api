/**
 * `fields-admin.spec.ts`
 * - `GET /mocks/fields/admin` over express (supertest), checked by `checkFieldsAdmin()` of lemon-core.
 * - the same check and fixture run on the local server and the deployed Lambda (`npm run fields:admin`, lemon-core `lemon-fields-admin`).
 * - a separate spec: it does not import `backend-proxy.spec`, so it runs on its own.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-28 initial version (lemon-core v5 `fields/admin`).
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
import { checkFieldsAdmin, FieldsAdminExpect } from 'lemon-core';
import { app } from '../../express';
import request from 'supertest';
import path from 'path';
//! expected `fields/admin` report, shared with `npm run fields:admin` (lemon-core `lemon-fields-admin`, default `--expect` for `mocks`).
import expected from './fields-admin.expected.json';

//! no such file: the AWS SDK then finds no profile at all.
const NO_FILE = path.join(__dirname, 'no-such-aws-file');

//! env for these tests; `undefined` deletes the name. the express app resolves an AWS profile per request,
//! so `PROFILE=''` and no config files make it fall back to `[default]`, which it ignores when missing.
const ENV: { [key: string]: string | undefined } = {
    PROFILE: '',
    AWS_PROFILE: undefined,
    AWS_CONFIG_FILE: NO_FILE,
    AWS_SHARED_CREDENTIALS_FILE: NO_FILE,
};

//! env names that open or close the `fields/admin` gate, and the ones in `ENV`.
const NAMES = ['LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME', ...Object.keys(ENV)];

//! set (or delete) each name of a map in `process.env`.
const setEnv = (M: { [key: string]: string | undefined }) =>
    Object.entries(M).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));

//! main body.
describe('fields/admin of /mocks', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    //* save the values before each test (the profile may set them), then apply `ENV`.
    let saved: { [key: string]: string | undefined } = {};
    beforeEach(() => {
        saved = NAMES.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
        setEnv(ENV);
    });
    //* restore (or delete) each name after each test.
    afterEach(() => setEnv(saved));

    //* local mode: 200, and the report passes the shared check with the fixture.
    it('should pass GET /mocks/fields/admin in local mode', async () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        const res = await request(app).get('/mocks/fields/admin');
        expect(res.status).toEqual(200);
        const want: FieldsAdminExpect = {
            ...(expected as FieldsAdminExpect),
            runtime: { local: true, external: true, lambda: false },
        };
        expect(checkFieldsAdmin(JSON.parse(res.text), want)).toEqual({ ok: true, issues: [] });
    });

    //* not local and an external request (express): the gate answers 403.
    it('should deny GET /mocks/fields/admin without LOCAL_MODE', async () => {
        delete process.env.LOCAL_MODE;
        const res = await request(app).get('/mocks/fields/admin');
        expect(res.status).toEqual(403);
        expect(res.text).toEqual(
            '403 NOT ALLOWED - fields/admin is local or direct-invoke only @doGetAdmin(mocks/fields)',
        );
    });
});
