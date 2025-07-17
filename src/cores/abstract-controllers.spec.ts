/**
 * `abstract-controllers.spec.ts`
 * - test script for `abstract-crud-controllers.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2022-07-27 support { initialNo, throwable }
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 * @date        2023-10-12 optimized `doList()` w/o ES6.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/codes-backend-api/cores`
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
import { $rand, $T, expect2, GETERR } from 'lemon-core';
import { $ES6 } from './abstract-services';
import { AbstractCRUDController, AbstractTransformer } from './abstract-controllers';
import { View, Body } from './types';

//* project dependant
import { AuthType, ModelType, TestModel, TestModelManager } from './abstract-services.spec';
import * as $backend from './abstract-services.spec';

export interface MyView extends View, Partial<TestModel> {
    /**
     * text in korean
     */
    ko: string;
}
export interface MyBody extends Body, Partial<MyView> {}
export class MyTransformer extends AbstractTransformer<TestModel, MyView, MyBody> {
    public modelAsView(model: TestModel, hasCores?: boolean): MyView {
        const view = super.modelAsView(model, hasCores);
        return {
            ...view,
            ko: '',
            name: $T.S(model.name),
        };
    }
    public bodyToModel(body: MyBody, isCreate?: boolean): TestModel {
        const model = super.bodyToModel(body, isCreate);
        if (body?.name !== undefined) model.name = $T.S(body.name);
        if (body?.test !== undefined) model.test = $T.N(body.test);
        return model;
    }
}

//* create instance.
export const instance = (options?: { auth?: AuthType; session?: boolean; domain?: string; roles?: string[] }) => {
    const { service, current, context } = $backend.instance(options?.auth, {
        domain: options?.domain,
        roles: options?.roles,
    });
    const trans = new MyTransformer();
    const useSession = options?.session ?? true;
    // test about '/tests/' api

    // How to extends AbstractCRUDController
    // 1. extend AbstractCRUDController class
    // 2. set super(<apiPathType>, backend-service, my-ModelManager in backend-service, { <transformer> ...})
    // 3. if want to create method(POST), add make model method in backend-proxy.makeModel()

    const api = new (class extends AbstractCRUDController<
        ModelType,
        TestModel,
        MyView,
        MyBody,
        any,
        TestModelManager,
        MyTransformer
    > {
        public constructor() {
            super('tests', service, service.$test, trans, { useSession });
        }
    })();
    return { api, current, service, trans, context };
};

//* main test body.
describe('AbstractCRUDController', () => {
    //* test transformer
    it('should pass basic transformer', async () => {
        const PROFILE = await loadProfile(process); // override process.env.
        PROFILE && console.info('! PROFILE=', PROFILE);

        const { trans } = instance();

        // 기본형
        expect2(() => trans.modelAsView({ sid: 'a', uid: 'b' })).toEqual({
            ko: '',
            name: '',
        });

        // `useCores` 활성화시.
        expect2(() => trans.modelAsView({ sid: 'a', uid: 'b' }, true)).toEqual({
            $: {
                sid: 'a',
                uid: 'b',
            },
            ko: '',
            name: '',
        });

        //* test asDate().
        expect2(() => trans.asDate(null as any)).toEqual('');
        expect2(() => trans.asDate('22-01-22')).toEqual('.date[22-01-22] is invalid format - asDate()');
        expect2(() => trans.asDate('2022-00-22')).toEqual('.date[2022-00-22] is invalid format - asDate()');
        expect2(() => trans.asDate('2022-01-00', 'some')).toEqual('.some[2022-01-00] is invalid format - asDate()');
        expect2(() => trans.asDate('2022-01-22')).toEqual('2022-01-22');
    });

    //* test doList(session)
    it('should pass doList(authed)', async () => {
        const { api, context, service, current } = instance({ auth: 'authed', session: true });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual('403 IDENTITY-TOKEN - check x-lemon-identity');

        expect2(await api.doList('', { test: '' }, null, context).catch(GETERR)).toEqual(
            '403 IDENTITY-TOKEN - check x-lemon-identity',
        );

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual(
            '403 IDENTITY-TOKEN - check x-lemon-identity',
        );
    });

    //* test doList(session)
    it('should pass doList(session)', async () => {
        const { api, context, service, current } = instance({ auth: 'session', session: true });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: '1000008', uid: '1000007', roles: ['user'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '1000008',
                uid: '1000007',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        expect2(() => $ES6.options).toEqual();

        //* check if has no field like `hello`
        expect2(
            await api
                .doList('', { hello: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000008' } },
                    ],
                },
            },
        });

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000008' } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if test exists
        expect2(
            await api
                .doList('', { test: '!' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000008' } },
                    ],
                    must: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000008' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });

        //* check if test(number) eq 0
        expect2(await api.doList('', { test: '0' }, null, context).catch(GETERR)).toEqual({
            limit: 10,
            list: {
                from: 0,
                query: {
                    bool: {
                        filter: [
                            { term: { 'ns.keyword': 'TT' } },
                            { term: { 'type.keyword': 'test' } },
                            { term: { deletedAt: 0 } },
                            { term: { test: 0 } },
                            { term: { 'sid.keyword': '1000008' } },
                        ],
                    },
                },
                size: 10,
                aggs: {
                    stereo: { terms: { field: 'stereo.keyword', missing: 'N/A', order: { _key: 'asc' }, size: 10 } },
                },
                sort: { createdAt: { missing: '_last', order: 'desc' } },
            },
            page: 0,
            total: 0,
        });
        expect2(await api.doGetList('1000001', { sid: 'a' }, null, context).catch(GETERR)).toEqual({
            limit: 10,
            list: {
                aggs: {
                    stereo: { terms: { field: 'stereo.keyword', missing: 'N/A', order: { _key: 'asc' }, size: 10 } },
                },
                from: 0,
                query: {
                    bool: {
                        filter: [
                            { term: { 'ns.keyword': 'TT' } },
                            { term: { 'type.keyword': 'test' } },
                            { term: { deletedAt: 0 } },
                            { term: { 'sid.keyword': '1000008' } },
                        ],
                    },
                },
                size: 10,
                sort: { createdAt: { missing: '_last', order: 'desc' } },
            },
            page: 0,
            total: 0,
        });
    });

    //* test doList(admin)
    it('should pass doList(session/admin)', async () => {
        const { api, context, service, current } = instance({ auth: 'session', session: true, roles: ['admin'] });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: '1000008', uid: '1000007', roles: ['admin'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '1000008',
                uid: '1000007',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        expect2(() => $ES6.options).toEqual();

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': '1000008' } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': 'a' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });
        const result = await api.doGetAdmin('', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result.param).toEqual({ sid: 'a', uid: 'b' });
        expect2(() => result.context).toEqual({ clientIp: '221.0.0.13' });
        expect2(() => result.hello).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        expect2(await api.doGetAdmin('1000001', { sid: 'a', uid: 'b' }, null, context).catch(GETERR)).toEqual(
            '403 NOT ALLOWED - only from local!',
        );
    });

    //* test doList(offsite/admin)
    it('should pass doList(offsite/admin)', async () => {
        const { api, context, service, current } = instance({ auth: 'offsite', session: true, roles: ['admin'] });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: null, uid: '1000007', roles: ['admin'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '',
                uid: '1000007',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        expect2(() => $ES6.options).toEqual({
            autocompleteFields: [],
            docType: '_doc',
            endpoint: 'https://localhost:9710',
            idName: '$id',
            indexName: 'test-v7.10',
            version: '7.10',
        });

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': 'a' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });
    });

    //* test doList(localhost)
    it('should pass doList(session)', async () => {
        const { api, context, service, current } = instance({ auth: 'session', session: true, domain: 'localhost' });
        expect2(() => context?.identity, 'roles').toEqual({ roles: ['user'] });

        expect2(
            await service.guardProxy(context, proxy => Promise.resolve(proxy.getCurrentSession())).catch(GETERR),
            'sid,uid,roles',
        ).toEqual({ sid: '1000008', uid: '1000007', roles: ['user'] });

        //* test of making new model w/ session
        expect2(await api.doPost('0', null, {}, context).catch(GETERR)).toEqual({
            $: {
                sid: '1000008',
                uid: '1000007',
            },
            id: '1000001',
            ko: '',
            name: '',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        //* bypass if no ES settings.
        if (!$ES6.options) {
            expect2(await api.doList('', { hello: '' }, null, context).catch(GETERR)).toEqual(
                `400 NO DYNAMO - table:${service.tableName}!`,
            );
            return;
        }
        expect2(() => $ES6.options).toEqual();

        //* check if test is empty
        expect2(
            await api
                .doList('', { test: '' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        // { term: { 'sid.keyword': '1000008' } },
                    ],
                    must_not: [{ exists: { field: 'test' } }],
                },
            },
        });

        //* check if support internal { sid, uid }
        expect2(
            await api
                .doList('', { sid: 'a', uid: 'b' }, null, context)
                .then(R => R.list)
                .catch(GETERR),
            'query',
        ).toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'sid.keyword': 'a' } },
                        { term: { 'uid.keyword': 'b' } },
                    ],
                },
            },
        });
        const result = await api.doGetAdmin('', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result.id).toEqual('');
        expect2(() => result.param).toEqual({ sid: 'a', uid: 'b' });
        expect2(() => result.context).toEqual({ clientIp: '221.0.0.13' });
        expect2(() => result.hello).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );

        const result2 = await api.doGetAdmin('1000001', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result2.id).toEqual('1000001');
        expect2(() => result2.createdAt).toEqual(current);
        expect2(() => result2.updatedAt).toEqual(current);
        expect2(() => result2.deletedAt).toEqual(0);
        expect2(() => result2.ns).toEqual('TT');
        expect2(() => result2.sid).toEqual('1000008');
        expect2(() => result2.uid).toEqual('1000007');
        expect2(() => result2.type).toEqual('test');

        const result3 = await api.doGetAdmin('initialize', { sid: 'a', uid: 'b' }, null, context);
        expect2(() => result3.id).toEqual('initialize');
        expect2(() => result3.list).toEqual([
            { $: {}, id: '10000', ko: '', name: '' },
            { $: {}, id: '10001', ko: '', name: 'Hong' },
        ]);
    });

    //* test `/hello` route
    it('should normal CRUD: tests/1', async () => {
        const { api, current } = instance({ session: false });
        expect2(() => api.hello()).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );

        const $ts = {
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        };

        // get not exist
        expect2(await api.doGet('').catch(GETERR)).toEqual('@id (string) is required!');
        expect2(await api.doGet('1').catch(GETERR)).toEqual('404 NOT FOUND - proxy/test/id:1');
        expect2(await api.doGet(' 1').catch(GETERR)).toEqual('404 NOT FOUND - proxy/test/id:1');
        expect2(await api.doGet(' 1 ').catch(GETERR)).toEqual('404 NOT FOUND - proxy/test/id:1');
        expect2(await api.doGet(' 1 1 ').catch(GETERR)).toEqual('404 NOT FOUND - proxy/test/id:11');

        // // == post ======================================================
        expect2(await api.doPost('', null, { name: 'test', test: -1 }, undefined).catch(GETERR)).toEqual(
            '.test (number) is required (greater than 0)',
        );
        expect2(await api.doPost('1', null, { name: 'test', test: -1 }, undefined).catch(GETERR)).toEqual(
            '@id (string) is invalid!',
        );
        const newPost: any = await api.doPost('', null, { name: 'test', test: 1 }, undefined).catch(GETERR);
        expect2(() => newPost, 'id').toEqual({ id: '1000001' });

        //WARN - double checking of `validateModel` for `makeModel`.
        expect2(() => newPost).toEqual({ id: '1000001', ko: '', name: 'test', ...$ts });

        // == get ======================================================
        // get newPost
        expect2(await api.doGet(newPost.id).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test',
            ...$ts,
        });

        // == update ======================================================
        // put newPost
        expect2(await api.doPut('0', null, { name: 'test2' }).catch(GETERR)).toEqual('@id (string) is required!');
        expect2(await api.doPut(newPost.id, null, { name: 'test2' }).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test2',
            ...$ts,
        });
        // check updated newPost
        expect2(await api.doGet(newPost.id).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test2',
            ...$ts,
        });

        // == delete======================================================
        // delete not exists
        expect2(await api.doDelete('not_exists').catch(GETERR)).toEqual('404 NOT FOUND - proxy/test/id:not_exists');
        // delete newPost
        expect2(await api.doDelete('0').catch(GETERR)).toEqual('@id (string) is required!');
        expect2(await api.doDelete(newPost.id).catch(GETERR)).toEqual({
            id: newPost.id,
            ko: '',
            name: 'test2',
            ...$ts,
            deletedAt: current,
        });
        // check deleted newPost (soft delete)
        expect2(await api.doGet(newPost.id).catch(GETERR)).toEqual('404 NOT FOUND - test:1000001');
        expect2(await api.doDelete(newPost.id).catch(GETERR)).toEqual('404 NOT FOUND - test:1000001');
    });

    //* test `findLookup$()` in manager
    it('should pass findLookup$()', async () => {
        const { api, current, service } = instance();
        expect2(() => api.hello()).toEqual(
            'api:tests/typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        const $ts = {
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        };

        //* define function.s
        const initialNo = 1000000;
        const fxLookup = (key: string, params?: any) =>
            service.$test.findLookup$(key, { useSha256: false, resetRate: 1, isUseMeta: true, initialNo, ...params });
        const fxSha256 = (key: string, params?: any) =>
            service.$test.findLookup$(key, { useSha256: true, resetRate: 1, isUseMeta: true, initialNo, ...params });

        expect2(await fxLookup('', { throwable: true }).catch(GETERR)).toEqual(
            `404 NOT FOUND - _id:TT:test:#811c9dc5.0`,
        );

        expect2(await fxLookup('').catch(GETERR)).toEqual({
            _id: 'TT:test:#811c9dc5.0',
            id: `#811c9dc5.0`,
            type: '#test',
            stereo: '#',
            meta: { hash: '811c9dc5', text: '' },
            lock: 1,
            next: initialNo + 1,
            ...$ts,
        });
        expect2(await fxSha256('').catch(GETERR)).toEqual({
            _id: 'TT:test:#1B2M2Y8AsgTpgAmY7PhCfg==.0',
            id: '#1B2M2Y8AsgTpgAmY7PhCfg==.0',
            type: '#test',
            stereo: '#',
            meta: { hash: '1B2M2Y8AsgTpgAmY7PhCfg==', text: '' },
            lock: 1,
            next: initialNo + 2,
            ...$ts,
        });

        //* check multiple calles.
        const tasks = $rand.range(10).map(() => fxLookup('1'));
        const results = await Promise.all(tasks);
        const expectId1 = initialNo + 3;
        expect2(() => results.map(N => ({ id: N.id, next: N.next }))).toEqual([
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
            { id: '#340ca71c.1', next: expectId1 },
        ]);

        expect2(await fxLookup('1')).toEqual({
            _id: 'TT:test:#340ca71c.1',
            id: `#340ca71c.1`,
            type: '#test',
            stereo: '#',
            meta: { hash: '340ca71c', text: '1' },
            lock: 10,
            next: expectId1,
            ...$ts,
        });

        //* fail to initialize the lookup key
        service.$test.storage.increment = async () => {
            return { lock: 0 } as TestModel;
        };
        const result = await service.$test
            .findLookup$('test-depth', { resetRate: 0, isUseMeta: true })
            .catch(e => e.message);
        expect2(result).toEqual('@depth[101] is out of range - findLookup(test-depth)');
    });
});
