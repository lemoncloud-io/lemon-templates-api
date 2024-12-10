/**
 * `search-service.spec.ts`
 * - unit test for `search-service` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2021-12-07 initial version
 * @date        2021-12-17 customized from origin
 *
 * @origin      lemon-accounts-api
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from 'lemon-core/dist/environ';
import { do_parrallel, expect2, GETERR, NUL404, _it } from 'lemon-core';
import { SearchBody } from './model';
import { BatchHandler, SearchService } from './service';

//! create service instance.
export const instance = (type: string = 'dummy') => {
    const tableName = 'Test'; // partion-key should be `_id`
    const nsName = 'TT';
    const endpoint = 'https://localhost:8443';
    const indexName = 'test-v1';
    const docType = '_doc';
    const service = new SearchService(tableName, nsName, { endpoint, indexName, docType });
    const current = new Date().getTime();
    service.setCurrent(current);
    return { type, service, current };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('SearchService', () => {
    const PROFILE = loadProfile();
    PROFILE && console.log(`PROFILE = `, PROFILE);

    //! basic function
    it('should pass basic functions', async done => {
        const { service } = instance();
        const [T, F] = [true, false];

        expect2(() => service.hello()).toEqual('search-service:TT/Test/test-v1');

        //! test of making id
        expect2(() => service.asKey('#query', 1)).toEqual('TT:#query:1');
        expect2(() => service.$query.asIdByName('1')).toEqual('#name/1');

        //! validate name format.
        expect2(() => service.$query.validateId('')).toEqual(F);
        expect2(() => service.$query.validateId('1')).toEqual(F);
        expect2(() => service.$query.validateId('11')).toEqual(T);
        expect2(() => service.$query.validateId('01')).toEqual(F);

        //! validate name format.
        expect2(() => service.$query.validateName('')).toEqual(F);
        expect2(() => service.$query.validateName(' ')).toEqual(F);
        expect2(() => service.$query.validateName('a')).toEqual(T);
        expect2(() => service.$query.validateName('A')).toEqual(F);

        expect2(() => service.$query.validateName('abc-09-1')).toEqual(T);
        expect2(() => service.$query.validateName('abc-X-1')).toEqual(F);
        expect2(() => service.$query.validateName('abc-X 1')).toEqual(F);
        expect2(() => service.$query.validateName('abc-09-')).toEqual(F);
        expect2(() => service.$query.validateName('1bc-09-1')).toEqual(F);
        expect2(() => service.$query.validateName('-09-1')).toEqual(F);

        expect2(() => service.$query.validateName(' ', true)).toEqual('@name[ ] is invalid format - type:#query');
        expect2(() => service.$query.validateName('A', true)).toEqual('@name[A] is invalid format - type:#query');

        //! test asQuery()
        expect2(() => service.$query.asQuery('')).toEqual(null);
        expect2(() => service.$query.asQuery([] as any)).toEqual('@query<object> is invalid');
        expect2(() => service.$query.asQuery({} as any)).toEqual('@query<object> is invalid');
        expect2(() => service.$query.asQuery('{"a":2}')).toEqual({ a: 2 });
        expect2(() => service.$query.asQuery('{"a":{{x}}}', { x: 2 })).toEqual({ a: 2 });
        expect2(() => service.$query.asQuery('{"{{y}}":{{x}}}', { x: 2, y: 'a' })).toEqual({ a: 2 });

        done();
    });

    //! batch handler
    it('should pass batch handler', async done => {
        const { service } = instance();
        const waited = <T>(ret: T, err?: any): Promise<T> =>
            new Promise((resolve, reject) => {
                setTimeout(() => (err ? reject(err) : resolve(ret)), 2);
            });
        const plus = async (a: number, x: number = 1) => Promise.resolve(a + x);
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

        service.setBatchHandler('plus-1', plus1);
        service.setBatchHandler('err-1', err1);
        service.setBatchHandler('err-2', err2);

        const inputs = [{ count: 1 }, { id: '2' }];
        // eslint-disable-next-line prettier/prettier
        expect2(await service.runBatchHandler('none-1', inputs).catch(GETERR)).toEqual('@name[none-1] (batch-handler) is invalid!');
        expect2(await service.runBatchHandler('plus-1', inputs).catch(GETERR)).toEqual([{ count: 2 }, { count: 1 }]);
        expect2(await service.runBatchHandler('err-1', inputs).catch(GETERR)).toEqual('@list[2] has error!');
        expect2(await service.runBatchHandler('err-2', inputs).catch(GETERR)).toEqual('@list[2] has error!');

        done();
    });

    //! CRUD operations.
    _it('should pass basic CRUD with storage', async done => {
        const { service, current } = instance();
        const $mrg = service.$query;

        //! pre-condition.
        const name = 'test-01';
        const $old = await $mrg.findByName(name).catch(NUL404);
        if ($old) await $mrg.storage.delete($old.id, true);

        //! test common in manager.
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

        //! test query-manager.
        expect2(await $mrg.saveQuery('my-query', { query: {} }).catch(GETERR), '!_id').toEqual({
            query: '{"query":{}}',
            updatedAt: current,
        });
        expect2(await $mrg.readQuery('my-query').catch(GETERR)).toEqual({ query: {} });

        done();
    });

    //! search function
    _it('should pass search functions', async done => {
        const { service } = instance();

        /* eslint-disable prettier/prettier */
        expect2(() => service.hello()).toEqual('search-search:https://localhost:8443/accounts-v3');

        const size = 1;
        const search_after = undefined as any;
        const ns = 'SS';
        const type = 'account';

        //! 검색어 준비하기...
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
                    must_not: [
                        { term: { 'stereo.keyword': '#' } },
                    ],
                    should: [
                        { term: { deletedAt: 0 } },
                        { exists: { field: 'email' } },
                        { exists: { field: 'extra.agreed' } }
                    ],
                    minimum_should_match: 1,
                },
            },
            sort: [{ 'id.keyword': 'desc' }, { deletedAt: 'asc' }],
            _source: 'id,name,extra'.split(','),
        };
        // const { list, last, total } = await service.search($body);
        /* eslint-enable prettier/prettier */

        const total = 6607;
        const _srch = (body: SearchBody) => service.search(body).then(R => ({ ...R, total }));

        //! size를 통한 1번째 검색이 가능해야함.
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

        //! last 커서로 추가 검색이 반드시 가능해야함.
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

        //! test async *generator()
        const _gens = (body: SearchBody) => service.generateSearchResult(body);
        const gen01 = _gens({ ...$body });
        expect2(await gen01.next()).toEqual({
            done: false,
            value: [{ ...item1 }],
        });
        expect2(await gen01.next()).toEqual({
            done: false,
            value: [{ ...item2 }],
        });

        /* eslint-enable prettier/prettier */
        done();
    });
});
