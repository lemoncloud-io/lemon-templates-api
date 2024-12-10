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
import { $U, expect2, GETERR } from 'lemon-core';
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

    //! GET `/hello` w/ route
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

    //! basic CRUD
    it('should pass basic CRUD', async () => {
        const { api, current, type } = instance();
        const _ts = (type?: string) => ({ createdAt: current, updatedAt: current, deletedAt: 0 });

        // get not exist
        expect2(await api.doGet('1').catch(GETERR)).toEqual(`404 NOT FOUND - proxy/${type}/id:1`);

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
        expect2(await api.doDelete('not_exists').catch(GETERR)).toEqual(`404 NOT FOUND - proxy/${type}/id:not_exists`);

        // delete newPost
        expect2(await api.doDelete(view1st.id).catch(GETERR)).toEqual({
            ..._ts(type),
            ...api.modelAsView(body1st),
            id: '1000001',
            name: 'hello2',
            deletedAt: current,
        });

        // check deleted newPost (soft delete)
        expect2(await api.doGet(view1st.id).catch(GETERR)).toEqual(`404 NOT FOUND - ${type}:1000001`);
    });

    //! check proxy.validate
    it('should pass validate routine for POST/PUT', async () => {
        const { api, current, type } = instance();

        // get not exist
        expect2(await api.doGet('1').catch(GETERR)).toEqual(`404 NOT FOUND - proxy/${type}/id:1`);

        const expected = {
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
});
