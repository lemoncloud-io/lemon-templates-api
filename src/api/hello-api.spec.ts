/**
 * `hello-api.spec.ts`
 * - sample unit test for `hello-api`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-03 initial version
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, loadJsonSync, $U } from 'lemon-core';
import { app } from '../express';
import request from 'supertest';

//! main test body.
describe('hello-api', () => {
    const $pack = loadJsonSync('package.json');

    //* jest 29 (jest-circus) rejects `async done =>`; async tests return the promise instead.
    it('should pass express route: GET /', async () => {
        const res = await request(app).get('/');
        expect2(res).toMatchObject({ status: 200 });
        expect(res.text).toContain(`${$pack.name}/${$pack.version}`);
    });

    it(`should pass GET /hello/0`, async () => {
        const res = await request(app).get(`/hello/0?name=lemon`);
        expect2(res).toMatchObject({
            status: 200,
            text: $U.json({ hello: 'hello-api-controller:hello-none' }),
        });
    });

    it(`should pass POST /hello/0`, done => {
        request(app)
            .post(`/hello/0`)
            .set('Authorization', `Basic jest`)
            .type(0 ? 'form' : 'json')
            .send({ name: 'a@b.c' })
            //* v5 B17: `postHello()` returns `id` since 990dcd7 (templates-api change, not lemon-core); the spec never followed.
            .expect(200, { id: '0', hello: 'hello-api-controller:hello-none', body: { name: 'a@b.c' } })
            .end(done);
    });
});
