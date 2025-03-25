/**
 * `search-service.spec.ts`
 * - unit test for `search-service` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2021-12-07 initial version
 * @date        2021-12-17 customized from origin
 * @date        2024-12-20 optimized with `lemon-core#3.2.11`
 *
 * @origin      lemon-templates-api
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
import { do_parrallel, expect2, GETERR, NUL404, _it, $U, _ES6 } from 'lemon-core';
import { SearchBody } from './model';
import { BatchHandler, SearchService } from './service';
import { $ES6 } from '../../cores/abstract-services';
import * as $service from '../../service/backend-service.spec';

//! create service + search instance.
export const instance = (type = 'dummy') => {
    const { service, current } = $service.instance(type ? 'public' : 'authed');
    const _search = () => {
        if (type === '') {
            return service.createSearchService($ES6.options);
        }
        //* prepare dummy
        const tableName = 'Test'; // partion-key should be `_id`
        const nsName = 'TT';
        const endpoint = 'https://localhost:8443'; //need `ssh tunneling`
        const indexName = 'test-v1';
        const docType = '_doc';
        const search = new SearchService(tableName, nsName, { endpoint, indexName, docType });
        search.setCurrent(current);
        return search;
    };
    const search = _search();
    return { type, service, search, current };
};

//* main test body.
describe('SearchService', () => {
    const PROFILE = loadProfile();
    PROFILE && console.log(`PROFILE = `, PROFILE);

    //* basic function
    it('should pass basic functions', async () => {
        const { search } = instance();
        const [T, F] = [true, false];

        expect2(() => search.hello()).toEqual('search-service:TT/Test/test-v1');

        //* test of making id
        expect2(() => search.asKey('#query', 1)).toEqual('TT:#query:1');
        expect2(() => search.$query.asIdByName('1')).toEqual('#name/1');

        //* validate name format.
        expect2(() => search.$query.validateId('')).toEqual(F);
        expect2(() => search.$query.validateId('1')).toEqual(F);
        expect2(() => search.$query.validateId('11')).toEqual(T);
        expect2(() => search.$query.validateId('01')).toEqual(F);

        //* validate name format.
        expect2(() => search.$query.validateName('')).toEqual(F);
        expect2(() => search.$query.validateName(' ')).toEqual(F);
        expect2(() => search.$query.validateName('a')).toEqual(T);
        expect2(() => search.$query.validateName('A')).toEqual(F);

        expect2(() => search.$query.validateName('abc-09-1')).toEqual(T);
        expect2(() => search.$query.validateName('abc-X-1')).toEqual(F);
        expect2(() => search.$query.validateName('abc-X 1')).toEqual(F);
        expect2(() => search.$query.validateName('abc-09-')).toEqual(F);
        expect2(() => search.$query.validateName('1bc-09-1')).toEqual(F);
        expect2(() => search.$query.validateName('-09-1')).toEqual(F);

        expect2(() => search.$query.validateName(' ', true)).toEqual('@name[ ] is invalid format - type:#query');
        expect2(() => search.$query.validateName('A', true)).toEqual('@name[A] is invalid format - type:#query');

        //* test asQuery()
        expect2(() => search.$query.asQuery('')).toEqual(null);
        expect2(() => search.$query.asQuery([] as any)).toEqual('@query<object> is invalid');
        expect2(() => search.$query.asQuery({} as any)).toEqual('@query<object> is invalid');
        expect2(() => search.$query.asQuery('{"a":2}')).toEqual({ a: 2 });
        expect2(() => search.$query.asQuery('{"a":{{x}}}', { x: 2 })).toEqual({ a: 2 });
        expect2(() => search.$query.asQuery('{"{{y}}":{{x}}}', { x: 2, y: 'a' })).toEqual({ a: 2 });
    });

    //* batch handler
    it('should pass batch handler', async () => {
        const { search } = instance();
        const waited = <T>(ret: T, err?: any): Promise<T> =>
            new Promise((resolve, reject) => {
                setTimeout(() => (err ? reject(err) : resolve(ret)), 2);
            });
        const plus = async (a: number, x = 1) => Promise.resolve(a + x);
        const plus1: BatchHandler = async (list: { count?: number }[]) => {
            const results = await do_parrallel(list, async item => {
                const count = await plus(item?.count || 0, 1);
                return { count };
            });
            return results;
        };
        const err1: BatchHandler = (list: any[]) => {
            throw new Error(`@list[${list?.length}] has error!`);
        };
        const err2: BatchHandler = async (list: any[]) => {
            throw new Error(`@list[${list?.length}] has error!`);
        };

        expect2(await waited('xxx').catch(GETERR)).toEqual('xxx');
        expect2(await waited(Promise.resolve('xxx'))).toEqual('xxx');
        expect2(await waited('xxx', 'yyy').catch(GETERR)).toEqual('yyy');

        expect2(await plus1([])).toEqual([]);
        expect2(await plus1([{ count: 1 }, { name: '2' }])).toEqual([{ count: 2 }, { count: 1 }]);
        expect2(() => err1([])).toEqual('@list[0] has error!');
        expect2(await err2([]).catch(GETERR)).toEqual('@list[0] has error!');

        search.setBatchHandler('plus-1', plus1);
        search.setBatchHandler('err-1', err1);
        search.setBatchHandler('err-2', err2);

        const inputs = [{ count: 1 }, { id: '2' }];
        // eslint-disable-next-line prettier/prettier
        expect2(await search.runBatchHandler('none-1', inputs).catch(GETERR)).toEqual('@name[none-1] (batch-handler) is invalid!');
        expect2(await search.runBatchHandler('plus-1', inputs).catch(GETERR)).toEqual([{ count: 2 }, { count: 1 }]);
        expect2(await search.runBatchHandler('err-1', inputs).catch(GETERR)).toEqual('@list[2] has error!');
        expect2(await search.runBatchHandler('err-2', inputs).catch(GETERR)).toEqual('@list[2] has error!');
    });

    //* CRUD operations.
    _it('should pass basic CRUD with storage', async () => {
        const { search, current } = instance();
        const $mrg = search.$query;

        //* pre-condition.
        const name = 'test-01';
        const $old = await $mrg.findByName(name).catch(NUL404);
        if ($old) await $mrg.storage.delete($old.id, true);

        //* test common in manager.
        // expect2(await $mrg.findByName(name).catch(GETERR)).toEqual('404 NOT FOUND - #query:name/test-01');
        expect2(await $mrg.saveByName(name, { query: 'hello' }).catch(GETERR), '!_id').toEqual({
            query: 'hello',
            updatedAt: current,
        });
        expect2(await $mrg.findByName(name).catch(GETERR), 'id,name,query').toEqual({
            id: '1000001',
            name: 'test-01',
            query: 'hello',
        });

        //* test query-manager.
        expect2(await $mrg.saveQuery('my-query', { query: {} }).catch(GETERR), '!_id').toEqual({
            query: '{"query":{}}',
            updatedAt: current,
        });
        expect2(await $mrg.readQuery('my-query').catch(GETERR)).toEqual({ query: {} });
    });

    //* search function
    _it('should pass search functions', async () => {
        const { search } = instance();

        expect2(() => search.hello()).toEqual('search-search:https://localhost:8443/accounts-v3');

        const size = 1;
        const search_after = undefined as any;
        const ns = 'SS';
        const type = 'account';

        //* 검색어 준비하기...
        const $body: SearchBody = {
            size,
            search_after,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': ns } },
                        { term: { 'type.keyword': type } },
                        { range: { 'extra.agreed': { gt: 0 } } }, // old ones
                    ],
                    must_not: [{ term: { 'stereo.keyword': '#' } }],
                    should: [
                        { term: { deletedAt: 0 } },
                        { exists: { field: 'email' } },
                        { exists: { field: 'extra.agreed' } },
                    ],
                    minimum_should_match: 1,
                },
            },
            sort: [{ 'id.keyword': 'desc' }, { deletedAt: 'asc' }],
            _source: 'id,name,extra'.split(','),
        };
        // const { list, last, total } = await service.search($body);

        const total = 6607;
        const _srch = (body: SearchBody) => search.search(body).then(R => ({ ...R, total }));

        //* size를 통한 1번째 검색이 가능해야함.
        const res01 = await _srch($body);
        const item1 = {
            _score: null as any,
            id: 'naver:99938241',
            name: 'wngkfls0628',
            extra: {
                agreed: 1,
                birth: 20030628,
                color1: 'summer_mute',
                color2: 'summer_light',
            },
        };
        expect2(() => res01).toEqual({
            aggregations: undefined,
            last: ['naver:99938241', 0],
            list: [{ ...item1 }],
            total,
        });

        //* last 커서로 추가 검색이 반드시 가능해야함.
        const res02 = await _srch({ ...$body, search_after: res01.last });
        const item2 = {
            _score: null as any,
            id: 'naver:9991918',
            name: '케로로차',
            extra: {
                agreed: 1,
                birth: 19990211,
                color1: 'spring_light',
                color2: 'spring_bright',
            },
        };
        expect2(() => res02).toEqual({
            aggregations: undefined,
            last: ['naver:9991918', 0],
            list: [{ ...item2 }],
            total,
        });

        //* test async *generator()
        const _gens = (body: SearchBody) => search.generateSearchResult(body);
        const gen01 = _gens({ ...$body });
        expect2(await gen01.next()).toEqual({
            done: false,
            value: [{ ...item1 }],
        });
        expect2(await gen01.next()).toEqual({
            done: false,
            value: [{ ...item2 }],
        });
    });

    //* search-proxy runing in local w/ access-key
    it('should pass search proxy(lemon)', async () => {
        //* lemon.dev 에 배포된 상태에서 테스트 진행함!
        const indexName = 'lemon-templates-v1';
        const endpoint = 'https://ag1qbtayhj.execute-api.ap-northeast-2.amazonaws.com/dev/search/0/proxy';

        //! WARN - must config the test section in `env/lemon.yml`
        expect2(() => $U.env('ES6_INDEX', '')).toEqual(indexName);
        if (PROFILE !== 'lemon') return; //* ignore if not in lemon profile.

        expect2(() => $U.env('ES6_ENDPOINT', '')).toEqual(endpoint);
        expect2(() => $ES6.options).toEqual(null);

        const $es = _ES6({ endpoint, indexName });
        expect2(() => $es?.elastic?.options, 'indexName,endpoint').toEqual({
            indexName,
            endpoint,
        });

        const { search } = instance('');
        expect2(() => search.hello()).toEqual(`search-service:TT/dummy-data.yml/${indexName}`);

        //* test of echo
        expect2(await search.search({ size: 0 }, { indexName: '#echo' }), '!context').toEqual({
            param: { indexName: '#echo' },
            body: {
                body: { size: 0 },
                index: '#echo',
                service: 'lemon-templates-api',
                signature: 'v1:lgLCkE2DyUsYjlqQw8RWYyyWieQGCt5077SuZkEfya8=',
            },
            // context: {
            //     identity: {
            //         accessKey: 'AKIAJMHS2OVFCUCEKXYA',
            //         accountId: '085403634746',
            //         caller: 'AIDAIARRLJP5R642RTOM4',
            //         identityId: null,
            //         identityPoolId: null,
            //         identityProvider: null,
            //         userAgent: 'Amazon CloudFront',
            //     },
            // },
        });

        expect2(await search.search(null, { indexName: '#describe-index' })).toEqual();
    });
});
