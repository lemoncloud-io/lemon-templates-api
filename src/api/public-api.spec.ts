/**
 * `public-api.spec.ts`
 * - unit test for `public-api` (`/public/{proxy+}` → registered controllers).
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-11-04 initial version.
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GeneralWEBController, NextContext, NextHandler, NextMode } from 'lemon-core';
import { PublicAPIController } from './public-api';
import mocks from '../modules/mock/api-mocks';
import { app } from '../express';
import request from 'supertest';

//! a fake target that records what it is asked to decode and call.
class FakeController extends GeneralWEBController {
    public decoded: { mode: NextMode; id: string; cmd: string }[] = [];
    public constructor(type = 'fakes') {
        super(type);
    }
    public hello = () => `fake-controller:${this.type()}`;
    // record the decode, and answer the call arguments back.
    public decode(mode: NextMode, id: string, cmd: string): NextHandler {
        this.decoded.push({ mode, id, cmd });
        return async (i, param, body, context) => ({ id: i, param, body, context });
    }
}

//! create a public controller with `mocks` and a fake target.
const instance = () => {
    const api = new PublicAPIController();
    const fake = new FakeController();
    api.addController(mocks);
    api.addController(fake);
    return { api, fake };
};

//! a guest context (as API Gateway NONE auth gives).
const context: NextContext = { clientIp: '127.0.0.1' } as NextContext;

//! main test body.
describe('PublicAPIController', () => {
    it('should pass registry (duplicate throws)', () => {
        const { api } = instance();
        expect2(() => api.type()).toEqual('public');
        expect2(() => api.addController(mocks)).toEqual('.type[mocks] is duplicated - public');
        expect2(() => api.addController(null)).toEqual('.type (string) is required - public');
    });

    it('should pass hello', async () => {
        const { api } = instance();
        const func = api.decode('GET', 'hello', '');
        expect2(() => typeof func).toEqual('function');
        expect2(await func('hello', null, null, context)).toEqual({ hello: 'public-api-controller:public' });
    });

    it('should pass GET/POST /public/mocks/0/hello', async () => {
        const { api } = instance();
        //* GET → `mocks.doGetHello`
        const get = api.decode('GET', 'mocks', '0/hello');
        expect2(() => typeof get).toEqual('function');
        const res1 = await get('mocks', { a: '1' }, null, context);
        expect2(() => res1, 'id,param,context').toEqual({
            id: '0',
            param: { a: '1' },
            context: { clientIp: '127.0.0.1', method: 'GET' },
        });
        expect2(() => res1.hello).toContain('mock-api-controller');
        //* POST → `mocks.doPostHello`
        const post = api.decode('POST', 'mocks', '0/hello');
        const res2 = await post('mocks', null, { name: 'x' }, context);
        expect2(() => res2, 'id,body,context').toEqual({
            id: '0',
            body: { name: 'x' },
            context: { clientIp: '127.0.0.1', method: 'POST' },
        });
    });

    it('should pass GET /public/mocks (mode unchanged)', async () => {
        const { api } = instance();
        //* GET with an empty id → `mocks.doGet('')` (not LIST).
        const func = api.decode('GET', 'mocks', '');
        expect2(await func('mocks', null, null, context).catch((e: Error) => e.message)).toEqual(
            '@id (string) is required - doGet(mocks/)',
        );
        //* GET /public/mocks/hello → `mocks.doGet('hello')`.
        const hello = api.decode('GET', 'mocks', 'hello');
        expect2(await hello('mocks', null, null, context)).toEqual({ hello: mocks.hello() });
    });

    it('should keep every segment after id (4th+ not dropped)', async () => {
        const { api, fake } = instance();
        const func = api.decode('GET', 'fakes', '0/a/b/c');
        expect2(() => fake.decoded).toEqual([{ mode: 'GET', id: '0', cmd: 'a/b/c' }]);
        expect2(await func('fakes', null, null, context), 'id').toEqual({ id: '0' });
        //* empty pieces are kept too (`/public/fakes//b` → id '', cmd 'b').
        api.decode('PUT', 'fakes', '/b');
        expect2(() => fake.decoded[1]).toEqual({ mode: 'PUT', id: '', cmd: 'b' });
    });

    it('should pass raw pieces untouched (no decode)', async () => {
        const { api, fake } = instance();
        const func = api.decode('GET', 'fakes', 'a%20b/x%2Fy');
        expect2(() => fake.decoded).toEqual([{ mode: 'GET', id: 'a%20b', cmd: 'x%2Fy' }]);
        expect2(await func('fakes', null, null, context), 'id').toEqual({ id: 'a%20b' });
    });

    it('should drop client $sub, and pass the context as is', async () => {
        const { api } = instance();
        const func = api.decode('GET', 'fakes', '1');
        const param = { $sub: 'x', q: 'y' };
        const res = await func('fakes', param, null, context);
        expect2(() => res.param).toEqual({ q: 'y' });
        expect2(() => res.context === context).toEqual(true);
        expect2(() => param).toEqual({ $sub: 'x', q: 'y' }); // the caller's object is not changed.
    });

    it('should return null if not registered (→ 404)', () => {
        const { api } = instance();
        expect2(() => api.decode('GET', 'other', '1')).toEqual(null);
        expect2(() => api.decode('GET', '', '')).toEqual(null);
        expect2(() => api.decode('GET', 'public', 'mocks/0')).toEqual(null);
        //* registered, but no handler in the target → null.
        expect2(() => api.decode('DELETE', 'mocks', '0/hello')).toEqual(null);
    });

    //* through the local API Gateway (`serverless.yml` routes) and `$web`.
    it('should pass express route: /public/{proxy+}', async () => {
        const res1 = await request(app).get('/public/mocks/0/hello');
        expect2(() => res1.status).toEqual(200);
        expect2(() => JSON.parse(res1.text), 'id').toEqual({ id: '0' });
        expect2(() => JSON.parse(res1.text).hello).toContain('mock-api-controller');

        const res2 = await request(app).post('/public/mocks/0/hello').send({ name: 'x' });
        expect2(() => res2.status).toEqual(200);
        expect2(() => JSON.parse(res2.text), 'id,body').toEqual({ id: '0', body: { name: 'x' } });

        const res3 = await request(app).get('/public/hello');
        expect2(() => res3, 'status,text').toEqual({
            status: 200,
            text: JSON.stringify({ hello: 'public-api-controller:public' }),
        });

        const res4 = await request(app).get('/public/other/1');
        expect2(() => res4.status).toEqual(404);
    });
});
