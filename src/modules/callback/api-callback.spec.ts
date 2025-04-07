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
        const { api, type, proxy, current, $ts, _ts } = instance();

        // get not exist
        expect2(await api.doGet('1').catch(GETERR)).toEqual(`404 NOT FOUND - proxy/${type}/id:1`);

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
        });

        // put newPost
        const body2nd = { name: 'test2' };
        expect2(await api.doPut(view1st.id, null as any, { ...body2nd }).catch(GETERR)).toEqual({
            ...expectedView,
            name: 'test2',
        });
        // check updated newPost
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual({
            ...expectedView,
            name: 'test2',
        });

        // delete not exists
        expect2(await api.doDelete('not_exists').catch(GETERR)).toEqual(`404 NOT FOUND - proxy/${type}/id:not_exists`);

        // delete newPost
        expect2(await api.doDelete(view1st.id).catch(GETERR)).toEqual({
            ...expectedView,
            deletedAt: current,
            name: 'test2',
        });

        // check deleted newPost (soft delete)
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual(`404 NOT FOUND - ${type}:1000001`);
    });
});
