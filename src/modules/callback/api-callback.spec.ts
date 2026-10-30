/**
 * `callback-api.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
//* override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
import { $U, expect2, GETERR } from 'lemon-core';
import { CallbackAPIController } from './api-callback';

import { AuthType, ServiceParams } from '../../service/backend-service.spec';
import * as $proxy from '../../service/backend-service.spec';
import { app } from '../../express';
import request from 'supertest';

//* create instance.
export const instance = (type: AuthType = 'authed', params?: ServiceParams) => {
    const { service, current, context, _ts } = $proxy.instance(type, params);
    const api = new (class extends CallbackAPIController {
        public constructor() {
            super(service);
        }
        public get trans() {
            return this.transformer;
        }
    })();
    const proxy = service.createProxy(context);
    const $ts = (id?: string, params?: any) => _ts(id, { type: undefined, ns: undefined, ...params });
    return { api, proxy, current, service, type: api.modelType, $ts, _ts };
};

//! main test body.
describe('CallbackAPIController', () => {
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

    //* test `/hello` w/ route
    it('should pass express route: GET /0/hello', async () => {
        const { api, type } = instance();
        const res = await request(app).get(`/${api.type()}/0/hello`);
        expect2(() => res).toMatchObject({
            status: 200,
            text: $U.json({
                id: '0',
                hello: `${type}-api-controller:${api.type()}`,
                param: {},
                body: {},
                context: { clientIp: '::ffff:127.0.0.1' },
            }),
        });
    });

    //* test basic CRUD
    it('should pass basic CRUD', async () => {
        const { api, proxy, current, $ts, _ts } = instance();
        // v5 B5 (lemon-core 5.0.10): no identity is allowed only in local mode — `canDo()` asks for the session otherwise (`403 IDENTITY-TOKEN`).
        useLocalMode();
        //* v5 B5 (lemon-core 5.0.10): in local mode a controller view always carries the cores `$` (`modelAsView`); `{}` as these rows have no sid/uid/gid.
        const $cores = { $: {} };

        // get not exist
        // v5 B17 (lemon-core 5.0.10): `AbstractCRUDController.doGet` throws `not found @doGet(<route>/<id>)` (since f12b2d3, kept as-is in lemon-core extended/cores).
        expect2(await api.doGet('1').catch(GETERR)).toEqual(`404 NOT FOUND - not found @doGet(${api.type()}/1)`);

        //* validate body parameters.
        if (1) {
            expect2(await api.doPost('', null as any, undefined).catch(GETERR)).toEqual(
                `@body (object) is required - doPost(callback/)`,
            );
            expect2(await api.doPost('', null as any, '' as any).catch(GETERR)).toEqual(
                `@body (object) is required - doPost(callback/)`,
            );
            expect2(await api.doPost('', null as any, null).catch(GETERR)).toEqual(
                `@body (CallbackBody) is required - doPost(callback/)`,
            );
        }

        const body1st = { name: 'test', stereo: '' as any };
        expect2(() => api.trans.modelAsView(body1st)).toEqual({
            name: 'test',
            stereo: '',
        });

        const view1st = await api.doPost('', null as any, { ...body1st });
        expect2(() => view1st).toEqual({
            ...$ts('1000001'),
            ...api.trans.modelAsView(body1st),
            ...$cores,
        });

        const expectedView = {
            ...$ts('1000001'),
            ...api.trans.modelAsView(body1st),
            stereo: undefined,
        };

        expect2(await proxy.callback.get(view1st.id)).toEqual({
            ...expectedView,
            ..._ts('1000001', 'callback'),
        });

        // get newPost
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual({
            ...expectedView,
            ...$cores,
        });

        // put newPost
        const body2nd = { name: 'test2' };
        expect2(await api.doPut(view1st.id, null as any, { ...body2nd }).catch(GETERR)).toEqual({
            ...expectedView,
            ...$cores,
            name: 'test2',
        });
        // check updated newPost
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual({
            ...expectedView,
            ...$cores,
            name: 'test2',
        });

        // delete not exists
        // v5 B17 (lemon-core 5.0.10): `doDelete` throws `not found @doDelete(<route>/<id>)` (since f12b2d3).
        expect2(await api.doDelete('not_exists').catch(GETERR)).toEqual(
            `404 NOT FOUND - not found @doDelete(${api.type()}/not_exists)`,
        );

        // delete newPost
        expect2(await api.doDelete(view1st.id).catch(GETERR)).toEqual({
            ...expectedView,
            ...$cores,
            deletedAt: current,
            name: 'test2',
        });

        // check deleted newPost (soft delete)
        // v5 B17 (lemon-core 5.0.10): `doGet` of a soft-deleted row throws `deleted at <ts> @doGet(<route>/<id>)` (since f12b2d3).
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual(
            `404 NOT FOUND - deleted at ${$U.ts(current)} @doGet(${api.type()}/1000001)`,
        );
    });
});
