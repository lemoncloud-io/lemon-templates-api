/**
 * `api-tests.spec.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @date        2022-10-20 optimized to adapt typed CRUD.
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _it, describe, it, expect2, expect, GETERR } from '../../test-helpers/commons.spec';
import { $U } from 'lemon-core';
import { TestAPIController } from './api-tests';

import { AuthType, ServiceParams } from '../../service/backend-service.spec';
import * as $proxy from '../../service/backend-proxy.spec';
import { app } from '../../express';
import request from 'supertest';

//! create instance.
export const instance = (type: AuthType = 'authed', params?: ServiceParams) => {
    const { service, current, context } = $proxy.instance(type, params);
    const api = new TestAPIController(service);
    const proxy = service.createProxy(context);
    return { api, proxy, current, service, type: api.modelType };
};

//! main body.
describe('TestAPIController', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    //* v5 B17: save `LOCAL_MODE` and `AWS_LAMBDA_FUNCTION_NAME` before each test, and put them back (or delete them) after.
    const LOCAL_NAMES = ['LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME'];
    let savedEnv: { [key: string]: string | undefined } = {};
    beforeEach(() => (savedEnv = LOCAL_NAMES.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {})));
    afterEach(() =>
        Object.entries(savedEnv).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v))),
    );
    //* v5 B17: direct controller calls without a caller identity need local mode (HOW_TO_UPGRADE_V5 § 11.3).
    const useLocalMode = () => {
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    };

    //! GET `/hello` w/ route
    it('should pass express route: GET /0/hello', async () => {
        const { api, type } = instance();
        const res = await request(app).get(`/${api.type()}/0/hello`);
        expect2(() => res).toMatchObject({
            status: 200,
            text: $U.json({
                id: '0',
                hello: `${type}-api-controller:${api.type()}`,
                //* v5 B20: the local API Gateway sends what API Gateway sends — no query/body on GET → null; clientIp without `::ffff:`.
                param: null,
                body: null,
                context: { clientIp: '127.0.0.1' },
            }),
        });
    });

    //! basic CRUD
    it('should pass basic CRUD', async () => {
        const { api, current, type } = instance();
        // v5 B5 (lemon-core 5.0.10): no identity is allowed only in local mode — `canDo()` asks for the session otherwise (`403 IDENTITY-TOKEN`).
        useLocalMode();
        const _ts = (type?: string) => ({ createdAt: current, updatedAt: current, deletedAt: 0 });

        // get not exist
        // v5 B17 (lemon-core 5.0.10): `AbstractCRUDController.doGet` throws `not found @doGet(<route>/<id>)` (since f12b2d3, kept as-is in lemon-core extended/cores).
        expect2(await api.doGet('1').catch(GETERR)).toEqual(`404 NOT FOUND - not found @doGet(${api.type()}/1)`);

        const body1st = { name: 'hello' };
        const view1st = await api.doPost('', null as any, { ...body1st });
        expect2(() => view1st).toEqual({
            ..._ts(type),
            ...api.modelAsView(body1st),
            id: '1000001',
        });

        // get newPost
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual({
            ..._ts(type),
            ...api.modelAsView(body1st),
            id: '1000001',
        });

        // put newPost
        const body2nd = { name: 'hello2' };
        expect2(await api.doPut(view1st.id, null as any, { ...body2nd }).catch(GETERR)).toEqual({
            ..._ts(type),
            ...api.modelAsView(body1st),
            id: '1000001',
            name: 'hello2',
        });
        // check updated newPost
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual({
            ..._ts(type),
            ...api.modelAsView(body1st),
            id: '1000001',
            name: 'hello2',
        });

        // delete not exists
        // v5 B17 (lemon-core 5.0.10): `doDelete` throws `not found @doDelete(<route>/<id>)` (since f12b2d3).
        expect2(await api.doDelete('not_exists').catch(GETERR)).toEqual(
            `404 NOT FOUND - not found @doDelete(${api.type()}/not_exists)`,
        );

        // delete newPost
        expect2(await api.doDelete(view1st.id).catch(GETERR)).toEqual({
            ..._ts(type),
            ...api.modelAsView(body1st),
            id: '1000001',
            name: 'hello2',
            deletedAt: current,
        });

        // check deleted newPost (soft delete)
        // v5 B17 (lemon-core 5.0.10): `doGet` of a soft-deleted row throws `deleted at <ts> @doGet(<route>/<id>)` (since f12b2d3).
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual(
            `404 NOT FOUND - deleted at ${$U.ts(current)} @doGet(${api.type()}/1000001)`,
        );
    });

    //! check proxy.validate
    it('should pass validate routine for POST/PUT', async () => {
        const { api, current, type } = instance();
        // v5 B5 (lemon-core 5.0.10): no identity is allowed only in local mode — `canDo()` asks for the session otherwise (`403 IDENTITY-TOKEN`).
        useLocalMode();

        // get not exist
        // v5 B17 (lemon-core 5.0.10): `AbstractCRUDController.doGet` throws `not found @doGet(<route>/<id>)` (since f12b2d3, kept as-is in lemon-core extended/cores).
        expect2(await api.doGet('1').catch(GETERR)).toEqual(`404 NOT FOUND - not found @doGet(${api.type()}/1)`);

        //* v5 B5 (lemon-core 5.0.10): in local mode a controller view always carries the cores `$` (`modelAsView`); `{}` as these rows have no sid/uid/gid.
        const expected = {
            $: {},
            id: '1000001',
            name: 'X',
            deletedAt: 0,
            createdAt: current,
            updatedAt: current,
        };

        // for create
        //! checked from manager
        expect2(await api.doPost('0', {}, { name: '' }).catch(GETERR)).toEqual(
            `.name (string) is required - validate(${type}/)`,
        );
        //! checked from manager-proxy
        expect2(await api.doPost('0', {}, { name: '#' }).catch(GETERR)).toEqual(
            `.name[#] is invalid - validate(${type}/)`,
        );
        expect2(await api.doPost('0', {}, { name: '!' }).catch(GETERR)).toEqual(
            `.name[!] is invalid - validate(${type}/)`,
        );
        expect2(await api.doPost('0', {}, { name: 'X' }).catch(GETERR)).toEqual(expected);

        // for update
        //! checked from manager-proxy
        expect2(await api.doPut('1000001', {}, { name: '#' }).catch(GETERR)).toEqual(
            `.name[#] is invalid - validate(${type}/1000001)`,
        );
        expect2(await api.doPut('1000001', {}, { name: '!' }).catch(GETERR)).toEqual({
            ...expected,
            name: '!',
        });
        expect2(await api.doPut('1000001', {}, { name: '' }).catch(GETERR)).toEqual({
            ...expected,
            name: '',
        });
        expect2(await api.doPut('1000001', {}, { name: ' ' }).catch(GETERR)).toEqual({
            ...expected,
            name: '',
        });
        expect2(await api.doPut('1000001', {}, { name: 'X' }).catch(GETERR)).toEqual({
            ...expected,
            name: 'X',
        });
    });

    //! `pinned`: stored as 0|1 (`$T.BN`), shown as boolean (`$T.B`)
    it('should keep pinned as 0|1 in storage and boolean in view', async () => {
        const { api, proxy, service } = instance();
        // no identity: direct controller calls need local mode
        useLocalMode();

        // POST with a string flag → view `true`
        const view1 = await api.doPost('0', {}, { name: 'P', pinned: 'true' } as any);
        expect2(() => view1, 'pinned').toEqual({ pinned: true });
        const id = view1.id;

        // storage keeps the number 1 as its own field (not folded into `.meta`)
        const model1 = await proxy.test.get(id);
        expect2(() => model1, 'pinned').toEqual({ pinned: 1 });
        expect2(() => `${model1.meta ?? ''}`.includes('pinned')).toEqual(false);

        // PUT 0 → view `false`, storage 0 (read by the manager: `proxy.test.get()` returns its cached copy)
        expect2(await api.doPut(id, {}, { pinned: 0 } as any), 'pinned').toEqual({ pinned: false });
        expect2(await service.$test.find(id), 'pinned').toEqual({ pinned: 0 });

        // POST without `pinned` → no `pinned` key in the view
        const view3 = await api.doPost('0', {}, { name: 'Q' });
        expect2(() => Object.keys(view3).includes('pinned')).toEqual(false);
    });
});
