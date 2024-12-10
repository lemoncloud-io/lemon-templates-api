/**
 * `search-api.spec.ts`
 * - test script for `search-api`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-03-10 initial version
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
import { expect2, $U } from 'lemon-core';
import { SearchAPIController } from './api-search';
import { app } from '../../express';
import request from 'supertest';

//! create instance.
export const instance = (type: 'dummy' = 'dummy') => {
    const controller = new SearchAPIController();
    return { controller };
};

//! main test body.
describe('SearchController', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    //! test controller
    it('should pass w/ main-service', async done => {
        const { controller } = instance();
        /* eslint-disable prettier/prettier */
        expect2(controller.hello()).toEqual(`search-api:search`);
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test `/hello` route
    it('should pass express route: GET /0/hello', async done => {
        const res = await request(app).get('/search/0/hello');
        expect2(res).toMatchObject({
            status: 200,
            text: $U.json({ id: '', hello: 'search-api:search' }),
        });
        done();
    });
});
