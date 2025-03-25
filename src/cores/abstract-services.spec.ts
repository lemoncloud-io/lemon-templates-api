/**
 * `abstract-services.spec.spec.ts`
 * - test script for `abstract-services.spec.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-15 initial version
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/codes-backend-api/cores`
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
import { $U, expect2, GETERR, NextContext, NextIdentity, SearchBody, SearchResult } from 'lemon-core';
import { SimpleSet, CoreModel, filterFields, loadJsonSync } from 'lemon-core';
import { MyCoreManager, MyCoreProxy, MyCoreService, MyManagerProxy } from './abstract-services';
import { keys } from 'ts-transformer-keys';
import { PaginateParam } from './types';
import { loadSample } from './contexts.spec';

export type ModelType = 'test';
export type Model = CoreModel<ModelType>;

/**
 * `test`: internal test model.
 */
export interface TestModel extends Model {
    /** name of model */
    name?: string;
    /** test count */
    test?: number;

    /** (optional) extra */
    extra?: SimpleSet;

    /**
     * (optional) inner Object.
     */
    readonly Model?: Model;

    /**
     * (view) Access Infor.
     */
    readonly $identity?: NextIdentity;
}

export const $FIELD = {
    test: filterFields(keys<TestModel>()),
};

/**
 * class: `TestModelManager`
 */
export class TestModelManager extends MyCoreManager<TestModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('test', parent, $FIELD.test);
    }

    /**
     * @override validate
     */
    public async validateModel(model: TestModel, $org?: TestModel) {
        if (model.test && model.test <= 0) throw Error('.test (number) is required (greater than 0)');
        return model;
    }
}

/**
 * class: `BackendService`
 */
export class BackendService extends MyCoreService<Model, ModelType, BackendProxy> {
    public readonly $test: TestModelManager;
    public constructor(tableName?: string, ns?: string) {
        super(tableName, ns);
        this.$test = new TestModelManager(this);
    }

    /**
     * say hello()
     */
    public hello = (): string => `backend-service:${this.NS}/${this.tableName}`;

    /**
     * make proxy instance w/ this service.
     */
    public createProxy = (context: NextContext) => {
        const proxy = new BackendProxy(context, this);
        return proxy;
    };
}

/**
 * class: `BackendProxy`
 */
export class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    public readonly tests: MyManagerProxy<TestModel, TestModelManager, BackendService, ModelType>;
    public constructor(context: NextContext, service: BackendService) {
        super(context, service);
        this.tests = new MyManagerProxy(this, service.$test);
    }
}

/**
 * 각 인증 결과에 따른 예제
 *
 * @see `./contexts.spec.ts/$context[<type>]`
 */
export type AuthType = 'public' | 'authed' | 'session' | 'offsite' | 'signed';
export interface ServiceParams {
    /** the expected current timestamp */
    current?: number;
    /** flag of using dummy data (default true) */
    dummy?: boolean;
    /** overrided domain */
    domain?: string;
    /** override `roles` in identity */
    roles?: string[];
}

//* create service instance.
export const instance = (type: AuthType = 'authed', params?: ServiceParams) => {
    const current = params?.current ?? $U.current_time_ms();
    const isDummy = params?.dummy ?? true;
    const { context, data } = loadSample(type);
    if (params?.domain && context) (context as NextContext).domain = params?.domain;
    if (params?.roles && context?.identity) (context.identity as any).roles = params?.roles;
    const service = new (class extends BackendService {
        public constructor() {
            super(isDummy ? 'dummy-data.yml' : '');
        }
        public async doSearch<T>(body: SearchBody): Promise<SearchResult<T, any>> {
            //* returns the body as object.
            return { total: 0, list: body as any };
        }
    })();
    service.setCurrent(current);
    return { service, current, context, data };
};

//* main test body.
describe('abstract-services', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);

    it('should pass basic functions', async () => {
        const { service } = instance();
        expect2(() => true).toEqual(true);

        const isKeys = true;
        if (isKeys) {
            expect2(() => filterFields($FIELD.test).join(',')).toEqual(
                'name,test,extra,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id',
            );
            expect2(() => filterFields($FIELD.test, ['test']).join(',')).toEqual(
                'test,name,extra,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id',
            );
        } else {
            console.warn('check ts-transformer-keys!');
        }
        // test CoreService
        expect2(() => service.dynamoOptions).toEqual({ idName: '_id', tableName: 'dummy-data.yml' });

        // test CoreManager
        const { $test } = service;
        expect2($test.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        expect2(await $test.find('A')).toEqual(null);
        expect2(await $test.exists('A')).toEqual(false);
        expect2(await $test.findByKey('A')).toEqual(null);
        expect2(await $test.getMulti(['A', 'A'])).toEqual([null, null]);
        expect2(await $test.getMulti$(['A', 'A'])).toEqual({ A: { id: 'A', error: '404 NOT FOUND - test:A' } });
    });

    it('should pass ManagerProxy', async () => {
        const { service, current } = instance();
        const proxy = service.createProxy(null as any);

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        expect2(() => proxy.hello()).toEqual('manager-proxy:TT/dummy-data.yml');
        expect2(() => service.createProxy({}).hello()).toEqual('manager-proxy:TT/dummy-data.yml');

        const _base = <T extends Model>(type: ModelType, N?: T): Model => ({
            ns: 'TT',
            updatedAt: current,
            createdAt: current,
            deletedAt: 0,
            type,
            ...N,
        });

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a');
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:a');
        expect2(await service.$test.find('a')).toEqual(null);

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', true);
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:a');
        expect2(await service.$test.find('a')).toEqual(null);

        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', false);
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual("Cannot set properties of null (setting 'name')");
        expect2(await service.$test.find('a')).toEqual(null);

        //* get w/ default.
        expect2(
            await service
                .guardProxy({}, async proxy => {
                    const a = await proxy.tests.get('a', {});
                    a.name = 'hi a';
                    return a;
                })
                .catch(GETERR),
        ).toEqual({
            ..._base('test'),
            id: 'a',
            name: 'hi a',
        });
        expect2(await service.$test.find('a')).toEqual({
            _id: 'TT:test:a',
            ..._base('test'),
            id: 'a',
            name: 'hi a',
        });

        //* test of sample session.
        expect2(() => loadJsonSync(`./src/cores/context-session.json`)).toEqual({
            error: "ENOENT: no such file or directory, open './src/cores/context-session.json'",
        });

        const context = loadSample('session')?.context;
        expect2(() => context?.identity, 'sid,uid').toEqual({ sid: '1000008', uid: '1000007' });
        const identity = context?.identity;

        expect2(() => proxy.getCurrentSession({ throwable: true })).toEqual(
            '403 IDENTITY-TOKEN - .identity (IdentityToken) is required - context:',
        );
        const getCurrentSession = (options: {
            /** (default false for test) */
            throwable?: boolean;
            /** (default true) */
            useSession?: string | boolean;
            /** (optional) env.USE_SESSION */
            USE_SESSION?: string;
        }) => {
            options.throwable = options.throwable === undefined ? false : options.throwable;
            return proxy.getCurrentSession(options);
        };

        //! test with sample session.
        const dir = `sample/context-session.json`;
        const $ctx = loadJsonSync(dir)?.context?.identity;
        expect2(() => getCurrentSession({ useSession: false })).toEqual(null);
        expect2(() => getCurrentSession({ useSession: true, USE_SESSION: dir }), 'sid,uid').toEqual({
            sid: expect.any(String),
            uid: expect.any(String),
        });
        expect2(() => getCurrentSession({ useSession: true, USE_SESSION: dir }), 'sid,uid').toEqual({
            sid: $ctx.sid,
            uid: $ctx.uid,
        });
        expect2(() => getCurrentSession({ useSession: true })).toEqual(null);
        expect2(() => getCurrentSession({ useSession: '1', USE_SESSION: dir }), 'sid,uid').toEqual({
            sid: $ctx.sid,
            uid: $ctx.uid,
        });
        expect2(() => getCurrentSession({ useSession: '1' })).toEqual(null);
        expect2(() => getCurrentSession({ useSession: dir }), 'sid,uid').toEqual({
            sid: $ctx.sid,
            uid: $ctx.uid,
        });

        expect2(() => getCurrentSession({ useSession: 'wrongPath' })).toEqual(
            "@file[wrongPath] is invalid, ENOENT: no such file or directory, open './wrongPath'",
        );
        expect2(() => getCurrentSession({ useSession: '1', USE_SESSION: 'wrongPath' })).toEqual(null);
        expect2(() => getCurrentSession({ USE_SESSION: 'wrongPath' })).toEqual(null);

        expect2(() => proxy.asCurrentIdentityId(context)).toEqual(identity.identityId);

        const parent: CoreModel = {
            sid: '0000008',
            uid: '0000007',
        };
        const model1: Model = {
            id: '1000001',
            sid: '1000008',
            uid: '1000007',
        };
        const model2: Model = {
            id: '1000001',
        };
        expect2(() => proxy.makeModelBase(model1)).toEqual(model1);
        expect2(() => proxy.makeModelBase(model1, { parent: parent })).toEqual(model1);
        expect2(() => proxy.makeModelBase(model1, { useSession: true })).toEqual(model1);
        expect2(() => proxy.makeModelBase(model2)).toEqual(model2);
        expect2(() => proxy.makeModelBase(model2, { parent: parent })).toEqual({
            id: '1000001',
            sid: '0000008',
            uid: '0000007',
        });
    });

    it('should pass packSearchParam(session)', async () => {
        const { service, context } = instance('session');

        expect2(
            await service
                .guardProxy(context, async proxy => {
                    expect2(() => proxy.tests.packSearchParam({})).toEqual({
                        $page: { limit: 10, page: 0 },
                        $param: {},
                    });
                    expect2(() => proxy.tests.packSearchParam({ page: '1' })).toEqual({
                        $page: { limit: 10, page: 1 },
                        $param: {},
                    });
                    return proxy.tests.packSearchParam(
                        { page: '1', offset: '2', limit: '3' },
                        { name: '' },
                        { useSession: true },
                    );
                })
                .catch(GETERR),
        ).toEqual({ $page: { limit: 3, offset: 2, page: 1 }, $param: { name: '', sid: '1000008' } });
    });

    it('should pass buildQuery for ES', async () => {
        const { service } = instance();

        const param: PaginateParam = {
            limit: 30,
            page: 1,
        };

        const baseExpected = {
            from: 30,
            size: 30,
            sort: { createdAt: { missing: '_last', order: 'desc' } },
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                },
            },
            aggs: { stereo: { terms: { field: 'stereo.keyword', missing: 'N/A', order: { _key: 'asc' }, size: 10 } } },
        };

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        expect2(() => service.$test.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );

        //* validate param option
        expect2(() => service.$test.buildQuery({})).toEqual('.limit(number) is required - buildQuery()');
        expect2(() => service.$test.buildQuery({ limit: '30' as any })).toEqual(
            '.limit(number) is required - buildQuery()',
        );
        expect2(() => service.$test.buildQuery({ limit: '30' as any, page: 10 })).toEqual(
            '.limit(number) is required - buildQuery()',
        );
        // expect2(() => service.$test.buildQuery({ limit: 30 })).toEqual('.page(number) is required - buildQuery()');
        expect2(() => service.$test.buildQuery({ limit: 30, page: '10' as any })).toEqual(
            '.page(number) is required - buildQuery()',
        );
        expect2(() => service.$test.buildQuery({ limit: 30, page: 0, offset: '10' as any })).toEqual(
            '.offset(number) is required - buildQuery()',
        );

        //* validate filter by attributes
        expect2(() => service.$test.buildQuery(param)).toEqual({
            ...baseExpected,
        });
        expect2(() => service.$test.buildQuery({ ...param, offset: 1 })).toEqual({
            ...baseExpected,
            from: baseExpected.from + 1,
        });
        expect2(() => service.$test.buildQuery(param, { _idx: 0 })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { _idx: 0 } },
                    ],
                },
            },
        });
        expect2(() => service.$test.buildQuery(param, { _date: '2023-02-08' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { '_date.keyword': '2023-02-08' } },
                    ],
                },
            },
        });
        expect2(() => service.$test.buildQuery(param, { name: 'lemon' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { 'name.keyword': 'lemon' } },
                    ],
                },
            },
        });
        expect2(() => service.$test.buildQuery(param, { _idx: 0, _date: '2023-02-08', name: 'lemon' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                        { term: { _idx: 0 } },
                        { term: { '_date.keyword': '2023-02-08' } },
                        { term: { 'name.keyword': 'lemon' } },
                    ],
                },
            },
        });

        //* validate add must
        expect2(() => service.$test.buildQuery(param, { name: '!' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must: [{ exists: { field: 'name' } }],
                },
            },
        });

        //* validate add must_not
        expect2(() => service.$test.buildQuery(param, { name: '' })).toEqual({
            ...baseExpected,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must_not: [{ exists: { field: 'name' } }],
                },
            },
        });
        //* validate default filter.
        expect2(() => service.$test.buildQuery(param, { stereo: null as any }), 'query').toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must_not: [{ term: { 'stereo.keyword': '#' } }],
                },
            },
        });

        //* validate filter by attributes.
        expect2(() => service.$test.buildQuery(param, { extra: ['a', 'b'] as any }), 'query').toEqual({
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                    must: [
                        {
                            bool: {
                                minimum_should_match: 1,
                                should: [{ term: { 'extra.keyword': 'a' } }, { term: { 'extra.keyword': 'b' } }],
                            },
                        },
                    ],
                },
            },
        });

        //* validate addSortTerm
        const $searchBody: SearchBody = {
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': 'TT' } },
                        { term: { 'type.keyword': 'test' } },
                        { term: { deletedAt: 0 } },
                    ],
                },
            },
            size: 0,
        };
        const addSortTermAgent = (sortString: string, searchBody?: SearchBody, parameter?: any) => {
            searchBody = searchBody ?? $searchBody;
            parameter = parameter ?? param;
            const { sort } = service.$test.addSortTerm($searchBody, { ...parameter, sort: sortString });
            return sort;
        };
        expect2(() => addSortTermAgent('id')).toEqual({ 'id.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('name')).toEqual({ 'name.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('brand')).toEqual({ 'brand.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('color')).toEqual({ 'color.keyword': { missing: '_last', order: 'asc' } });
        expect2(() => addSortTermAgent('createdAt')).toEqual({ createdAt: { missing: '_first', order: 'asc' } });
        expect2(() => addSortTermAgent('updatedAt')).toEqual({ updatedAt: { missing: '_first', order: 'asc' } });
        expect2(() => addSortTermAgent('a')).toEqual({ 'a.keyword': { missing: '_first', order: 'asc' } });

        //* validate buildSearchAll
        const result = service.$test.buildSearchAll();
        expect2(() => result._source).toEqual(['id', 'error', 'createdAt', 'name', 'test']);
        expect2(() => result.query).toEqual({
            bool: {
                filter: [{ term: { 'ns.keyword': 'TT' } }, { term: { 'type.keyword': 'test' } }],
                must: [
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                { range: { deletedAt: { lte: 0 } } },
                                {
                                    bool: {
                                        must_not: {
                                            exists: {
                                                field: 'deletedAt',
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
                must_not: [{ term: { stereo: '#' } }, { term: { 'stereo.keyword': '#' } }],
            },
        });
        expect2(() => result.size).toEqual(500);
        expect2(() => result.sort).toEqual({ createdAt: { missing: '_last', order: 'asc' } });
    });

    it('should pass ManagerProxy(authed)', async () => {
        const { service, context } = instance('authed');
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '0008540000',
            identityId: 'ap-northeast-2:c23d7fe4-1111-1111-1111-mocks-user',
        });
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(false);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(
            '403 NOT ALLOWED - invalid isSigned[true] @assertContext()',
        );
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(true);

        expect2(() => proxy.hasAdminRole()).toEqual(false);
        expect2(() => proxy.hasAdminRole('user')).toEqual(false);
    });

    it('should pass ManagerProxy(signed)', async () => {
        const { service, context } = instance('signed');
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '080000000746',
            identityId: null,
        });
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(false);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(true);
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(
            '403 NOT ALLOWED - invalid isAuthed[true] @assertContext()',
        );

        expect2(() => proxy.hasAdminRole()).toEqual(true);
        expect2(() => proxy.hasAdminRole('user')).toEqual(true);
    });

    it('should pass ManagerProxy(session)', async () => {
        const { service, context } = instance('session');
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '540000000059',
            identityId: 'ap-northeast-2:79a9bb80-0000-0000-0000-86fc750bbdf0',
        });
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(false);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(true);
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(true);

        expect2(() => proxy.hasAdminRole()).toEqual(false);
        expect2(() => proxy.hasAdminRole('user')).toEqual(true);
    });

    it('should pass ManagerProxy(session + local)', async () => {
        const { service, context } = instance('session', { domain: 'localhost' });
        const proxy = service.createProxy(context);

        expect2(() => proxy.getCurrentSession({ throwable: false }), 'accountId,identityId').toEqual({
            accountId: '540000000059',
            identityId: 'ap-northeast-2:79a9bb80-0000-0000-0000-86fc750bbdf0',
        });
        expect2(() => proxy.assertContext({ isLocal: true }, { throwable: false })).toEqual(true);
        expect2(() => proxy.assertContext({ isSigned: true })).toEqual(true);
        expect2(() => proxy.assertContext({ isAuthed: true })).toEqual(true);

        expect2(() => proxy.hasAdminRole()).toEqual(true);
        expect2(() => proxy.hasAdminRole('user')).toEqual(true);
    });

    it('should pass doScanLast', async () => {
        const { service } = instance();
        if (PROFILE !== 'lemon') return; // ignore this.
        const result = await service.$test.doScanLast({ limit: 3 });
        //* 1. doScanLast with { limit }
        expect2(() => result.count).toEqual(3);
        expect2(() => result.limit).toEqual(3);
        expect2(() => result.total).toEqual(3);
        expect2(() => result.last).toEqual({ _id: 'TT:test:1000243' });
        expect2(() => result.list).toEqual([
            {
                _id: 'TT:test:1000078',
                age: 2,
                createdAt: 1718688801255,
                deletedAt: 0,
                id: '1000078',
                name: '1718688801037',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718688801255,
            },
            {
                _id: 'TT:#query:1000017',
                createdAt: 1734325286081,
                deletedAt: 0,
                id: '1000017',
                name: '#',
                ns: 'TT',
                query: '{"query":{"query":{"bool":{"filter":{"term":{"type":"test"}}}},"aggs":{"test":{"terms":{"field":"count"}}},"sort":[{"count":{"order":"asc","missing":"_last"}}]}}',
                type: '#query',
                updatedAt: 1734325286131,
            },
            {
                _id: 'TT:test:1000243',
                age: 1,
                createdAt: 1718703832286,
                deletedAt: 0,
                id: '1000243',
                name: '1718703832078',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718703832286,
            },
        ]);
        //* 2. doScanLast with { limit, last }
        const resultWithLast = await service.$test.doScanLast({ limit: 3, last: { _id: 'TT:test:1000243' } });
        expect2(() => resultWithLast.count).toEqual(3);
        expect2(() => resultWithLast.limit).toEqual(3);
        expect2(() => resultWithLast.total).toEqual(3);
        expect2(() => resultWithLast.last).toEqual({ _id: 'TT:test:1000159' });
        expect2(() => resultWithLast.list).toEqual([
            {
                _id: 'TT:test:1000004',
                createdAt: 1711679260356,
                deletedAt: 0,
                id: '1000004',
                name: 'lemon',
                ns: 'TT',
                type: 'test',
                updatedAt: 1711679260356,
            },
            {
                _id: 'TT:test:1000212',
                age: 1,
                createdAt: 1718701431833,
                deletedAt: 0,
                id: '1000212',
                name: '1718701431689',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718701431833,
            },
            {
                _id: 'TT:test:1000159',
                age: 1,
                createdAt: 1718697350728,
                deletedAt: 0,
                id: '1000159',
                name: '1718697350582',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718697350728,
            },
        ]);

        //* 2.1 check whether $params works well
        const resultForVerification = await service.$test.doScanLast({ limit: 6 });

        expect2(() => resultForVerification.count).toEqual(6);
        expect2(() => resultForVerification.limit).toEqual(6);
        expect2(() => resultForVerification.total).toEqual(6);
        // expectedLast should be the last of doScanLast with { limit, last }
        const expectedLast = resultWithLast.last;
        expect2(() => resultForVerification.last).toEqual(expectedLast);
        // expectedList should be the list results of test step 1 & 2
        const expectedList = result.list.concat(resultWithLast.list);
        expect2(() => resultForVerification.list).toEqual(expectedList);

        //* 3. doScanLast with { limit, filter }
        const resultWithFilter = await service.$test.doScanLast({
            limit: 3,
            filter: { key: 'type', operator: 'contains', value: 'test' },
        });
        expect2(() => resultWithFilter.count).toEqual(2);
        expect2(() => resultWithFilter.limit).toEqual(3);
        expect2(() => resultWithFilter.total).toEqual(2);
        expect2(() => resultWithFilter.last).toEqual({ _id: 'TT:test:1000243' });
        expect2(() => resultWithFilter.list).toEqual([
            {
                _id: 'TT:test:1000078',
                age: 2,
                createdAt: 1718688801255,
                deletedAt: 0,
                id: '1000078',
                name: '1718688801037',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718688801255,
            },
            {
                _id: 'TT:test:1000243',
                age: 1,
                createdAt: 1718703832286,
                deletedAt: 0,
                id: '1000243',
                name: '1718703832078',
                ns: 'TT',
                type: 'test',
                updatedAt: 1718703832286,
            },
        ]);

        //* 4. doScanLast with last _id
        const checkLast = await service.$test.doScanLast({ limit: 20, last: { _id: 'TT:test:1000216' } });
        expect2(() => checkLast).toEqual();
        expect2(() => checkLast.count).toEqual(0);
        expect2(() => checkLast.limit).toEqual(20);
        expect2(() => checkLast.total).toEqual(0);
        expect2(() => checkLast.last).toEqual();
        expect2(() => checkLast.list).toEqual([]);
    });

    it('should pass migrate search-index', async () => {
        const { service } = instance();
        const result = await service.$test.doSyncScanLast({ limit: 10 });
        expect2(() => result.last).toEqual({ _id: 'TT:test:1000246' });
        expect2(() => result.count).toEqual(10);
        // expect2(() => result.took).toEqual(0.1);
        expect2(() => result.list[0], '!_version').toEqual({ _id: 'TT:test:1000078', error: undefined, status: 200 });
        expect2(() => result.list[1], '!_version').toEqual({ _id: 'TT:#query:1000017', error: undefined, status: 200 });
        expect2(() => result.list[2], '!_version').toEqual({ _id: 'TT:test:1000243', error: undefined, status: 200 });

        //* doSyncScanLast with last _id
        const checkLast = await service.$test.doSyncScanLast({ limit: 20, last: { _id: 'TT:test:1000216' } });
        expect2(() => checkLast.last).toEqual();
        expect2(() => checkLast.count).toEqual(0);
        // expect2(() => checkLast.took).toEqual(0.1);
        expect2(() => checkLast.list[0], '!_version').toEqual();
    });
});
