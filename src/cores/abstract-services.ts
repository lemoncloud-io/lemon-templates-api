/**
 * `abstract-services.ts`
 * - common services used in `/cores`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-15 initial version
 * @date        2022-06-24 fixed some failures.
 * @date        2022-07-27 support { initialNo, throwable }
 * @date        2022-08-04 opt `list()` w/ sort by createdAt:desc
 * @date        2022-08-09 use `SessionToken` from context
 * @date        2022-11-04 filter of `not exists` if param==''
 * @date        2022-11-15 use `buildQuery()` to build search-body.
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-13 optimized `makeModel()`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 * @date        2023-01-31 fixed null error of `model[key]`
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 * @date        2023-09-15 optimized `getCurrentSession()` w/ USE_SESSION + normalize option.
 * @date        2023-10-08 optimized `buildQuery()` w/ sort + offset.
 * @date        2023-10-11 optimized `doScan()` w/ dynamo-scan-filter.
 * @date        2024-11-01 optimized `nextId()` of manager-proxy
 * @date        2023-11-06 optimized `onAfterSave()` for post-processing.
 * @date        2024-11-14 renamed to `IdentityToken` from `SessionToken`
 * @date        2024-11-28 optimized `assertContext()` and `isAdminRole()` w/ `lemon-core@3.2.11`.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/codes-backend-api/cores`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, $T, _log, _inf, _err, $ES6, NUL404, $ERROR } from 'lemon-core';
import {
    GETERR$,
    CoreManager,
    CoreModel,
    CoreService,
    SearchBody,
    ManagerProxy,
    AbstractProxy,
    NextContext,
    getIdentityId,
    waited,
    SearchQuery,
    SortTerm,
    SimpleSet,
    SearchResult,
    loadJsonSync,
    DynamoScanService,
    DynamoScanFilter,
    DynamoScanResult,
    GeneralItem,
    NextIdentity,
    NextIdentityCognito,
    my_sequence,
} from 'lemon-core';
import { IdentityToken, ListResult, PaginateParam } from './types';
import { keys } from 'ts-transformer-keys';
import { onlyDefined } from './commons';
import { ApiResponse } from '@elastic/elasticsearch';
const NAME = $U.env('NAME', 'lemon');
const NS = $U.NS('HDBS', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * fields in core model.
 */
const CORE_FIELDS: string[] = keys<CoreModel>();

export type SearchParam<T> = T & { [key: string]: string | number };

interface BulkResponseBody {
    errors: boolean;
    items: BulkResponseItem[];
    took?: number;
}
interface BulkResponseItem<T = any> {
    index?: T;
}

/**
 * type: `ScanLastParams`
 */
export interface ScanLastParams {
    /** last cursor during scan */
    last?: any;
    /** (optional) limit to 1x scan */
    limit?: number;
    /** filter to scan */
    filter?: DynamoScanFilter;
}

/**
 * type: `ScanLastResult`
 */
export interface ScanLastResult<T = any> extends ListResult<T> {
    /** count of scan */
    count?: number;
    /** (optinoal) last of scan if there are more */
    last?: any;
}

/**
 * class: `MyCoreService`
 * - CoreService의 공통 부분을 채워넣는다.
 */
export abstract class MyCoreService<
    Model extends CoreModel<ModelType>,
    ModelType extends string,
    Proxy extends MyCoreProxy<ModelType, any>,
> extends CoreService<Model, ModelType> {
    public constructor(tableName?: string, ns?: string) {
        super(tableName, ns);
    }

    /**
     * make proxy instance w/ this service.
     */
    abstract createProxy(context: NextContext): Proxy;

    /**
     * make proxy, and use callback to handle.
     * - it will save automatically.
     */
    public guardProxy = async <T>(context: NextContext, callback: (proxy: Proxy) => Promise<T>): Promise<T> => {
        const proxy = this.createProxy(context);
        try {
            const result = await callback(proxy);
            const saved = await proxy.saveAllUpdates();
            _log(`> saved[${saved?.length}] =`, $U.json(saved));
            return result;
        } catch (e) {
            //WARN! force to save models even for exception @240613
            const saved = await proxy.saveAllUpdates().catch(e => GETERR$(e));
            _log(`> saved =`, $U.json(saved));
            throw e;
        }
    };

    /**
     * run search
     * - override this to hide `$ES6`
     */
    public async doSearch<T>(body: SearchBody): Promise<SearchResult<T>> {
        _log(`doSearch()`);
        _log(`> list.query =`, $U.json(body));
        const result = await $ES6.search<T>(body);
        _log(`> list.res =`, $U.json({ ...result, list: [result?.list?.[0]] }));
        return result;
    }

    /**
     * check if using useSession from environ.
     */
    public isUseSssion(): boolean {
        const USE_SESSION = $T.S($U.env('USE_SESSION', '')).toLowerCase();
        return USE_SESSION && USE_SESSION != '0' && USE_SESSION != 'false' ? true : false;
    }

    /**
     * check if search-engine is supportable
     * @returns
     */
    public hasSearchEngine(): boolean {
        const useSearch = !!$ES6.options?.indexName;
        return useSearch;
    }
}

/**
 * class: `CoreManager`
 * - shared core manager for all model
 *
 * @abstract
 */
export abstract class MyCoreManager<
    Model extends CoreModel<ModelType>,
    ModelType extends string,
    Service extends MyCoreService<Model, ModelType, any>,
> extends CoreManager<Model, ModelType, Service> {
    /**
     * namespace for log(print)
     */
    protected readonly logNS: string;

    /**
     * constructor
     * @protected
     */
    protected constructor(
        type: ModelType,
        parent: Service,
        fields: string[],
        public readonly options?: {
            /** enable to sync with es6 (default true) */
            enableSync?: boolean;
            /** unique field */
            uniqueField?: string;
            /** initial next-id number of auto-seq (default 1000000) */
            initialNo?: number;
        },
    ) {
        super(type, parent, fields, options?.uniqueField);
        const enableSync = options?.enableSync ?? true;
        if (enableSync) $ES6.synchronizer?.enableSynchronization(this.type);
        this.logNS = $U.NS(type, 'yellow');
    }

    /**
     * get the next sequenced no from `initialNo` (default 1000000)
     * @returns next seq-no
     */
    public async nextId(): Promise<number> {
        return this.storage.storage.nextSeq(this.storage.type, this.options?.initialNo);
    }

    /**
     * build default model for creation.
     */
    public buildDefault(id: string): Model {
        //WARN! do not include { last, balance } (avoid conflict)
        const $def = this.prepareDefault({ id } as Model);
        const $key = this.parent.asKey$(this.type, id);
        return onlyDefined({ ...$def, ...$key, _id: undefined });
    }

    /**
     * validate the request's model before saving.
     * - `$org`에 따라서, 신규 생성인지 업데이트인지 구분 가능함.
     *
     * @param model request's model
     * @param $org (optional) the origin model (valid ONLY if 업데이트)
     * @returns validatated model.
     */
    public async validateModel(model: Model, $org?: Model): Promise<Model> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const isCreate = !$org; // flag to indicate new creation.
        return model;
    }

    /**
     * find lookup-model (improved @2022)
     * - lookup to `auto-id` by key.
     * - if not exits, make the new id (auto-seq) and store the key.
     * - type should be like `#<type>`.
     *
     * NOTE! must to support race condition.
     *
     * @param key any string
     */
    public async findLookup$(
        key: string | number,
        params?: {
            /** rate to reset lock (default 0.9) */
            resetRate?: number;
            /** flag to use sha256 for hash (default true) */
            useSha256?: boolean;
            /** use meta to save lookup info (default false) */
            isUseMeta?: boolean;
            /** throw if lookup is not found (default false) - useful to check if exists of key */
            throwable?: boolean;
        },
    ): Promise<Model> {
        //! valida parameters...
        const resetRate = params?.resetRate ?? 0.9; // upper rate to reset lock
        const useSha256 = params?.useSha256 ?? true; // flag to use sha256 algorithm.
        const isUseMeta = params?.isUseMeta ?? false; // flag to use meta

        //! build hash...
        const text = typeof key === 'number' ? `${key}` : `${key || ''}`;
        const hash = useSha256 ? $U.md5(text, 'base64') : $U.hash(text);
        const keyId = `#${hash}.${text.length}`;

        //! recursive func to repeat
        const asyncAuto = async ($base: Model, depth = 0): Promise<Model> => {
            const keyId = $base.id;
            //NOTE - it will throw if no lookup exists.
            const $org = await this.storage.read(keyId).catch(e => {
                if (params?.throwable) throw e;
                return NUL404(e);
            });
            //! try to initialize the lookup key.......
            if (!$org || !$org?.next) {
                const $inc = { lock: 1 } as Model;
                const $ups = { stereo: $base.stereo, meta: $base.meta } as Model;
                const $lock = await this.storage.increment(keyId, $inc, $ups);
                if ($lock.lock === 1) {
                    // const nextId = await this.storage.storage.nextSeq(this.storage.type, params?.initialNo);
                    const nextId = await this.nextId();
                    const $ups = {
                        id: keyId,
                        type: `#${this.type}`,
                        next: nextId,
                        createdAt: $lock.createdAt ?? $lock.updatedAt,
                        deletedAt: 0,
                    } as Model;
                    const $updated = await this.storage.update(keyId, $ups);
                    return { ...$lock, ...$updated };
                } else if (depth > 100) {
                    throw new Error(`@depth[${depth}] is out of range - findLookup(${$base?.meta?.text})`);
                }
                //! in some rate, try to reset lock.
                const rate = Math.random();
                const wait = Math.round(rate * 10);
                return waited(wait)
                    .then(() => (rate > resetRate ? this.storage.update(keyId, { lock: 0 } as Model) : null))
                    .then(() => asyncAuto($base, depth + 1));
            }
            return $org;
        };
        //! make base model, and start loop.
        const meta: any = isUseMeta ? { hash, text } : undefined;
        const stereo: string = isUseMeta ? '#' : `#${text}`;
        return asyncAuto({ id: keyId, meta, stereo } as Model);
    }

    /**
     * build search query from filters
     */
    public buildQuery<T extends Model>(
        param: PaginateParam,
        model?: SearchParam<T>,
        options?: { errScope?: string },
    ): SearchBody {
        const errScope = options?.errScope ?? `- buildQuery()`;
        if (typeof param?.limit !== 'number') throw new Error(`.limit(number) is required ${errScope}`.trim());
        if (param?.page && typeof param?.page !== 'number')
            throw new Error(`.page(number) is required ${errScope}`.trim());
        if (param?.offset && typeof param?.offset !== 'number')
            throw new Error(`.offset(number) is required ${errScope}`.trim());

        // STEP.0 validate parameters.
        const { limit } = param;
        const page = $T.N(param?.page, 0);
        const offset = $T.N(param?.offset, 0);

        // 1. build search request body
        const body: SearchBody = {
            size: limit,
            from: limit * page + offset,
            query: {
                bool: {
                    filter: [
                        { term: { 'ns.keyword': this.parent.NS } },
                        { term: { 'type.keyword': this.type } },
                        { term: { deletedAt: 0 } },
                    ],
                },
            },
            aggs: {
                stereo: {
                    terms: {
                        field: 'stereo.keyword',
                        missing: 'N/A',
                        order: { _key: 'asc' },
                        size: 10,
                    },
                },
            },
        };

        //* helper function.
        const _add_filter = (query: SearchQuery | SearchQuery[]) => {
            const filter = [...((body.query.bool.filter as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.filter = filter;
        };
        const _add_must = (query: SearchQuery | SearchQuery[]) => {
            const must = [...((body.query.bool.must as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.must = must;
        };
        const _add_must_not = (query: SearchQuery | SearchQuery[]) => {
            const must_not = [
                ...((body.query.bool.must_not as any[]) || []),
                ...(Array.isArray(query) ? query : [query]),
            ];
            body.query.bool.must_not = must_not;
        };

        // 1-0. default filter.
        if (model?.stereo === null) {
            _add_must_not({ term: { [`stereo.keyword`]: '#' } });
        }

        // 1-1. filter by attributes.
        if (model && Object.keys(model).length > 0) {
            _inf(this.logNS, `> filters =`, $U.json(model));
            Object.entries(model).forEach(([key, val]) => {
                if (typeof val === 'string') {
                    if (val === '') {
                        _add_must_not({ exists: { field: `${key}` } });
                    } else if (val === '!') {
                        _add_must({ exists: { field: `${key}` } });
                    } else {
                        _add_filter({ term: { [`${key}.keyword`]: val } });
                    }
                } else if (val === null) {
                    // ignore
                } else if (typeof val === 'number') {
                    _add_filter({ term: { [`${key}`]: val } });
                } else if (typeof val === 'object' && Array.isArray(val)) {
                    _add_must({
                        bool: {
                            should: (val as any[]).map(n => ({
                                term: {
                                    [`${key}.keyword`]: n,
                                },
                            })),
                            minimum_should_match: 1,
                        },
                    });
                }
            });
        }

        // add sort term by `param.sort`
        return this.addSortTerm(body, param);
    }

    /**
     * sort 기준 추가하기.
     */
    public addSortTerm(body: SearchBody, param?: PaginateParam) {
        if (!body.sort) body.sort = { createdAt: { order: 'desc', missing: '_last' } };
        if (param?.sort) {
            const [sort, asc] = $T.S(param?.sort).split(':', 2);
            const order: 'asc' | 'desc' = `${asc || 'asc'}` as any;
            const missing: '_last' | '_first' = order == 'desc' ? '_last' : '_first';
            if (!sort) body.sort = undefined;
            else if (sort === 'id') body.sort = { 'id.keyword': { order, missing: '_last' } };
            else if (sort === 'name') body.sort = { 'name.keyword': { order, missing: '_last' } };
            else if (sort === 'brand') body.sort = { 'brand.keyword': { order, missing: '_last' } };
            else if (sort === 'color') body.sort = { 'color.keyword': { order, missing: '_last' } };
            else if (sort === 'createdAt') body.sort = { createdAt: { order, missing } };
            else if (sort === 'updatedAt') body.sort = { updatedAt: { order, missing } };
            else if (sort) body.sort = { [`${sort}.keyword`]: { order, missing } };
        }
        return body;
    }

    /**
     * build filter for scan.
     * @returns DynamoScanFilter
     */
    public buildScanFilter($param?: SearchParam<Model>): DynamoScanFilter {
        const filter: DynamoScanFilter = [
            { key: 'ns', comparator: '=', value: this.parent.NS },
            { key: 'type', comparator: '=', value: this.type },
            { not: { key: 'stereo', operator: 'begins_with', value: '#' } },
            { key: 'deletedAt', comparator: '=', value: 0 },
        ];

        return filter;
    }

    /**
     * execute scan with filter.
     *
     * @param $page
     * @param filter
     * @returns
     */
    public async doScan(
        $page: PaginateParam,
        filter?: DynamoScanFilter,
    ): Promise<ListResult<Model, { key: string; count: number }>> {
        const options = this.parent.dynamoOptions;
        const idName = options.idName || '_id';
        //* check if dummy table
        if (!options?.tableName || options?.tableName?.endsWith('.yml'))
            throw new Error(`400 NO DYNAMO - table:${options?.tableName ?? ''}!`);
        const $scan = new DynamoScanService(options);
        // const $res = await $scan.scan(-1, null, filter);
        const list0: Model[] = [];
        let $res: DynamoScanResult<GeneralItem>;
        while (true) {
            $res = await $scan.scan(-1, $res?.last, filter);
            $res.list?.forEach(N => {
                delete N[idName];
                list0.push(N as unknown as Model);
            });
            if (!$res?.last[idName]) break;
        }
        //* check if in unlimited..
        const limit = $page?.limit ?? 10;
        const page = $page?.page ?? 0;
        const unLimited = limit === -1 ? true : false;
        const total = list0?.length || 0;
        const _page = (list: Model[], page: number, limit: number) => {
            if (!unLimited && limit === 0) return [];
            else if (unLimited) return list;
            return list.slice(page * limit, (page + 1) * limit);
        };
        const list = _page(list0, page, limit);
        return { list, total, limit };
    }

    /**
     * execute scan-last with filter.
     *
     * @param $param ScanLastParams
     * @returns
     */
    public async doScanLast($param: ScanLastParams): Promise<ScanLastResult<Model>> {
        const options = this.parent.dynamoOptions;
        const idName = options.idName || '_id';
        const limit = $param?.limit ?? 2;
        const last = $param?.last;
        const filter = $param?.filter;

        if (!options?.tableName || options?.tableName?.endsWith('.yml')) {
            throw new Error(`400 NO DYNAMO - table:${options?.tableName ?? ''}!`);
        }

        const $scan = new DynamoScanService(options);
        const $res = await $scan.scan(limit, last, filter);

        const list: Model[] = $res.list?.map<Model>(N => {
            // do copy
            const M = { ...N };
            delete M[idName];
            return M as unknown as Model;
        });

        const total = $U.N(list?.length || 0);
        return onlyDefined({ list, total, limit: limit, count: $res?.count, last: $res?.last });
    }

    /**
     * basic ElasticSearch Query.
     * you can override this method for customization.
     *
     * @param limit pagination limit (default 10)
     * @param page page number (starts from 0)
     * @param filters model filters
     * @param param (optional) addtion params
     */
    public async list(
        $page: PaginateParam,
        $param?: SearchParam<Model>,
    ): Promise<ListResult<Model, { key: string; count: number }>> {
        _log(this.logNS, `list(${$page?.limit ?? ''}, ${$page?.page ?? ''})..`);

        //* use dynamo-scan if no search configuration.
        if (!this.parent.hasSearchEngine()) {
            const filter = this.buildScanFilter($param);
            return this.doScan($page, filter);
        }

        // 1. build search request body
        const body = this.buildQuery($page, $param);

        // 2. search w/ query
        const result = await this.parent.doSearch<Model>(body);

        // 3. extract names only
        const buckets = result?.aggregations?.names?.buckets || result?.aggregations?.stereo?.buckets;
        _log(this.logNS, `> buckets =`, $U.json(buckets));
        const aggr = (buckets as { key: string; doc_count: number }[])?.reduce<{ key: string; count: number }[]>(
            (R, bucket) => {
                const key = $T.S(bucket.key);
                const count = $T.N(bucket.doc_count, 0);
                R.push({ key, count });
                return R;
            },
            [],
        );

        // returns.
        return { total: result.total, list: result.list, aggr };
    }

    /**
     * list of projection fields
     * - ONLY fields defined in `goods-model`
     * - 모델별 추가 필드목록만 추림
     */
    public listProjections(params?: { includes?: string[]; excludes?: string[]; sorted?: boolean }) {
        const includes = params?.includes ?? ['id', 'error', 'createdAt'];
        const excludes = params?.excludes ?? ['extra', 'desc'];
        const isSorted = params?.sorted ?? true;
        const _notIn = (list: string[], $ref?: string[]) =>
            list.filter(s => !excludes?.includes(s) && !includes?.includes(s) && !$ref?.includes(s));
        const list = _notIn(this.FIELDS, CORE_FIELDS);
        if (isSorted) return [...includes, ...list.sort()];
        return [...includes, ...list];
    }

    /**
     * fetch all list of goods for filtering.
     *
     * @override if required.
     */
    public buildSearchAll(params?: { size?: number }, sort?: SortTerm): SearchBody {
        sort = sort ?? { createdAt: { order: 'asc', missing: '_last' } };
        const [ns, type] = [this.parent.NS, this.type];
        const size = params?.size ?? 500;
        const _source = this.listProjections({ excludes: ['extra', 'meta'] });
        const body: SearchBody = {
            size,
            query: {
                bool: {
                    filter: [{ term: { 'ns.keyword': ns } }, { term: { 'type.keyword': type } }],
                },
            },
            _source,
        };
        if (sort) body.sort = sort;
        const _add_filter = (query: SearchQuery | SearchQuery[]) => {
            const filter = [...((body.query.bool.filter as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.filter = filter;
        };
        const _add_must = (query: SearchQuery | SearchQuery[]) => {
            const must = [...((body.query.bool.must as any[]) || []), ...(Array.isArray(query) ? query : [query])];
            body.query.bool.must = must;
        };
        const _add_must_not = (query: SearchQuery | SearchQuery[]) => {
            const must_not = [
                ...((body.query.bool.must_not as any[]) || []),
                ...(Array.isArray(query) ? query : [query]),
            ];
            body.query.bool.must_not = must_not;
        };
        _add_must({
            bool: {
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
                minimum_should_match: 1,
            },
        });
        _add_must_not({ term: { stereo: '#' } });
        _add_must_not({ term: { 'stereo.keyword': '#' } });
        return body;
    }

    /**
     * doSyncScanLast w/o search, using Scan
     * 1. scan models with last + limit
     * 2. sync to index with bulk update.
     *
     * TODO - input(1D array) -> output(1D array)
     */
    public async doSyncScanLast(
        $param: ScanLastParams,
        options?: {
            /** chunk-size of bulk (default: 10) */
            size?: number;
        },
    ): Promise<ApiResponse<BulkResponseBody, any>[]> {
        //* 1. doScanLast(w/filter by type); scan-size = 100
        const $perf = $T.perf();
        const { list, last } = await this.doScanLast($param);

        //* 2. chunk the list into smaller parts
        const makeChucks = (list: any[], chunkSize: number) => {
            const result: any[][] = [];
            for (let i = 0; i < list.length; i += chunkSize) {
                result.push(list.slice(i, i + chunkSize));
            }
            return result;
        };
        const flattenList = (nestedList: any[]) => nestedList.flat();

        const chunkSize = options?.size ?? 10;
        const flattenedList = flattenList(list);
        const chunks = makeChucks(flattenedList, chunkSize);

        type Chunks<T = any> = {
            id: string;
            error: any;
            chunk: T[];
        };

        //* 3. use my_sequence to bulk each chunk sequentially
        const chunkList = chunks.map(
            (chunk, index): Chunks => ({
                id: `${index}`,
                error: null,
                chunk,
            }),
        );

        const createBulkOperations = (dataChunk: any[]) => {
            return dataChunk.reduce((acc, doc) => {
                acc.push({
                    index: {
                        _index: $ES6.options?.indexName,
                        _id: doc.id,
                    },
                });
                acc.push(doc);
                return acc;
            }, [] as Array<{ index: { _index: string; _id: string } }>);
        };

        const results = await my_sequence(chunkList, async (chunkWrapper, index) => {
            const operations = createBulkOperations(chunkWrapper.chunk);
            const res = await this.saveBulk(operations);
            return res;
        });
        const took = $perf.took();
        //TODO - reforming the result of `doSyncScanLast()` w/ { last, list }
        return results;
    }

    private async saveBulk(operations: any[]) {
        const elastic = $ES6.client;
        const bulkResponse: ApiResponse<BulkResponseBody, any> = await elastic
            .bulk({
                body: operations,
            })
            .catch(
                $ERROR.handler('bulk', e => {
                    throw e;
                }),
            );
        return bulkResponse;
    }
}

/**
 * class: `MyCoreProxy`
 * - common parent of proxy.
 */
export class MyCoreProxy<U extends string, MyService extends MyCoreService<CoreModel<U>, U, any>> extends AbstractProxy<
    U,
    MyService
> {
    public readonly managerProxies: { [propKey: string]: MyManagerProxy<any, any, MyService> } = {};
    public constructor(context: NextContext, service: MyService, cacheScope?: string) {
        super(context, service, 2, cacheScope ?? `${NAME}:${service.NS}:`); //! use `env.NAME` as default cache scope.
    }

    /**
     * register this.
     */
    public register(mgr: MyManagerProxy<any, any, MyService>) {
        const res = super.register(mgr);
        // also add into proxy lookup.
        this.addManagerProxy(mgr.$mgr.type, mgr);
        return res;
    }

    /**
     * add into proxy lookup.
     */
    protected addManagerProxy(modelType: U, proxy: MyManagerProxy<any, any, MyService>) {
        if (this.managerProxies[modelType]) {
            throw Error(`@modelType[${modelType}] is invalid - already exists!`);
        } else {
            this.managerProxies[modelType] = proxy;
        }
    }

    /**
     * get from lookup table.
     */
    public getManagerProxy<Model, ModelManager extends MyCoreManager<Model, U, MyService>>(
        modelType: U,
    ): MyManagerProxy<Model, ModelManager, MyService> {
        return this.managerProxies[modelType];
    }

    /**
     * get the `session-token` from current req-context.
     * - 1차 호출(front에서) 에서는 이 세션이 꼭 필요함.
     * - 2차 호출(protocol이용) 에서는 선택사항으로, 조절가능해야함! (#TODO - 이걸 어떻게 구불할것인가?)
     * - 로컬) 로컬 개발에서는 시뮬레이션 방법은 #TODO
     *
     * @param options.throwable flag to throw (default true)
     */
    public getCurrentSession(options?: {
        /** (default true) */
        throwable?: boolean;
        /** (default true) */
        normalize?: boolean;
        /** (default true) */
        useSession?: string | boolean;
        /** (optional) env.LOCAL_ACCOUNT */
        LOCAL_ACCOUNT?: string;
        /** (optional) env.USE_SESSION */
        USE_SESSION?: string;
    }): IdentityToken {
        // const useSession = !$U.env('LOCAL_ACCOUNT') ? $U.env('USE_SESSION') : null;
        const throwable = options?.throwable ?? true;
        const normalize = options?.normalize ?? true;
        const useSession = options?.useSession ?? true;
        const LOCAL_ACCOUNT = $T.S(options?.LOCAL_ACCOUNT ?? $U.env('LOCAL_ACCOUNT'));
        const USE_SESSION = $T.S(options?.USE_SESSION ?? $U.env('USE_SESSION'));
        LOCAL_ACCOUNT && _inf(this.service.NS, `> LOCAL_ACCOUNT =`, LOCAL_ACCOUNT);
        USE_SESSION && _inf(this.service.NS, `> use-session =`, useSession, USE_SESSION);

        const context: NextContext<IdentityToken> = this.context as any;
        //* WARN - in case of local, no need to throw error.
        const isLocal = context?.domain === 'localhost';

        // load the `session-token` from json file.
        const _load = (file: string): IdentityToken => {
            const data = loadJsonSync(file);
            if (typeof data?.error === 'string') throw new Error(`@file[${file}] is invalid, ${data.error}`);
            if (data?.context?.identity) return data?.context?.identity as IdentityToken;
            return data;
        };
        // load the `session-token` with req or env.
        const _session = (): IdentityToken => {
            //INFO - `userAgent`가 있다면, identity 생성 프로세스가 제대로 실행된것으로 판단해도됨! @240620.
            if (typeof (context?.identity as any)?.userAgent == 'string') return context?.identity;
            //TODO - 아래 코드는 개선의 여지가 있음(문제점???) @241210
            // if (typeof (context?.identity as any)?.identityId == 'string') return context?.identity;
            if (LOCAL_ACCOUNT) return null;
            if (useSession) {
                // _inf(this.service.NS, `> use-session =`, useSession, USE_SESSION);
                if (useSession === true || useSession === 'true' || useSession === '1') {
                    if (USE_SESSION.endsWith('.json')) return _load(USE_SESSION);
                    return null;
                } else if (typeof useSession === 'string' || useSession) {
                    return _load(useSession);
                }
            } else if (useSession === false) {
                return null;
            }
            return null;
        };
        const $sess = _session();
        // _inf(this.service.NS, `> use-session =`, $U.json($ses));
        if (throwable && !isLocal) {
            const eCode = `403 IDENTITY-TOKEN`;
            const err = $sess?.error
                ? `error:${$sess?.error}`
                : $sess?.meta
                ? `meta:${typeof $sess?.meta == 'string' ? $sess?.meta : $U.json($sess?.meta)}`
                : 'check x-lemon-identity';
            //* validate conditions..
            if (!$sess)
                throw new Error(`${eCode} - .identity (IdentityToken) is required - context:${$U.json(context)}`);
            if ($sess?.sid === undefined) throw new Error(`${eCode} - ${err}`);
            if (!$sess?.sid) throw new Error(`${eCode} - .sid (site-id) is required!`);
            if (!$sess?.uid) throw new Error(`${eCode} - .uid (user-id) is required!`);
        }

        //* normalize for the internal.
        const sid = normalize && $sess?.sid?.startsWith('#') ? null : $T.S2($sess?.sid);
        const uid = normalize && $sess?.uid?.startsWith('#') ? null : $T.S2($sess?.uid);

        //* returns.
        return $sess ? { ...$sess, sid, uid } : null;
    }

    /**
     * find the current identity-id from context.
     * - or, use env[LOCAL_ACCOUNT]
     */
    public asCurrentIdentityId = (context?: NextContext): string | null => {
        context = context ?? this.context;
        if (context?.domain === 'localhost' && !(context as any)?.identity?.identityId) {
            const LOCAL_ACCOUNT = $U.env('LOCAL_ACCOUNT', '');
            return LOCAL_ACCOUNT ? LOCAL_ACCOUNT : null;
        }
        return context && getIdentityId(context);
    };

    /**
     * assert context condition.
     */
    public assertContext(
        params?: {
            /** call in local */
            isLocal?: boolean;
            /** authed by cognito identity-provider */
            isAuthed?: boolean;
            /** signed call with access-key */
            isSigned?: boolean;
            /** check if session has role */
            hasRole?: string;
        },
        /** (optional) */
        options?: { throwable?: boolean; errScope?: string },
    ) {
        const context = this.context;
        const throwable = options?.throwable ?? true;
        const errScope = options?.errScope ?? `assertContext()`;
        const $idt = context?.identity as NextIdentityCognito;
        const isS = (s: string) => typeof s === 'string' && s?.length > 0;
        //* call in local
        const isLocal = context?.domain === 'localhost';
        //* signed call with access-key
        const isSigned = isS(($idt as any)?.accessKey);
        //* authed by cognito provider.
        const isAuthed = isS($idt?.identityProvider) && isS($idt?.identityId) && isS($idt?.identityPoolId);
        //* check if has role
        const _hasRole = (role: string): boolean => {
            const $sess = this.getCurrentSession({ throwable: false });
            return $sess?.roles?.includes(role);
        };

        const errCode = `403 NOT ALLOWED`;
        if (typeof params?.isLocal == 'boolean' && params?.isLocal != isLocal) {
            if (throwable) throw new Error(`${errCode} - invalid isLocal[${params?.isLocal}] @${errScope}`);
            return false;
        }
        if (typeof params?.isSigned == 'boolean' && params?.isSigned != isSigned) {
            if (throwable) throw new Error(`${errCode} - invalid isSigned[${params?.isSigned}] @${errScope}`);
            return false;
        }
        if (typeof params?.isAuthed == 'boolean' && params?.isAuthed != isAuthed) {
            if (throwable) throw new Error(`${errCode} - invalid isAuthed[${params?.isAuthed}] @${errScope}`);
            return false;
        }
        if (typeof params?.hasRole == 'string' && !_hasRole(params?.hasRole)) {
            if (throwable) throw new Error(`${errCode} - invalid hasRole[${params?.hasRole}] @${errScope}`);
            return false;
        }

        return true;
    }

    /**
     * check if current context has `admin` access
     * 1. run in local environ (or internal protocol with domin='localhost')
     * 2. access via signed access-key
     * 3. authorized cognito and has `admin` role in identity-token.
     *
     * @param role (default) admin
     * @param options optionals
     * @returns boolean
     */
    public isAdminRole(role = 'admin', options?: { errScope?: string }) {
        const $option = { ...options, throwable: false };
        if (this.assertContext({ isLocal: true }, $option)) return true;
        if (this.assertContext({ isSigned: true, isAuthed: false }, $option)) return true;
        if (this.assertContext({ isAuthed: true, hasRole: role }, $option)) return true;
        return false;
    }

    /**
     * prepare `next-context` w/ the customized { domain, userAgent }
     * @param identityId the target identity-id
     * @param options additional options.
     */
    public asNextContext<T extends NextIdentity>(
        identityId?: string,
        options?: {
            /** (optional) domain to override */
            domain?: string;
            /** (optional) userAgent to override */
            userAgent?: string;
            /** (optional) identity(object) to override */
            identity?: T;
        },
    ) {
        const $ctx = this.context;
        identityId = identityId ?? this.asCurrentIdentityId($ctx);
        const identity = options?.identity ?? ($ctx.identity as T);
        const session = this.getCurrentSession({ throwable: false });
        const $ctx2: NextContext<any> = {
            ...$ctx,
            domain: options?.domain ?? $ctx.domain,
            userAgent: options?.userAgent ?? $ctx.userAgent,
            identity: {
                ...session,
                ...identity,
                identityId,
            },
        };
        return $ctx2 as NextContext<T>;
    }

    /**
     * from `session-token`, make base of model { sid, uid }
     * @param proxy the current proxy.
     * @returns base model
     */
    public async makeModelBase<M extends CoreModel<U>>(
        model: M,
        options?: {
            /** use this parent to prepare base-model. (hiher than session) */
            parent?: CoreModel;
            /** flag to use session (default as confUseSession) */
            useSession?: boolean;
            /** flag to throw error (default true) */
            throwable?: boolean;
        },
    ): Promise<M> {
        const useSession = options?.useSession ?? false;
        const throwable = options?.throwable ?? false;
        const base = model ?? ({} as any);
        // STEP.0 populate with current parent.
        if (options?.parent) {
            const parent = options.parent;
            base['sid'] = base['sid'] ?? parent?.sid;
            base['uid'] = base['uid'] ?? parent?.uid;
        }
        // STEP.1 use session if applicable
        if (useSession) {
            const parent = this.getCurrentSession({ throwable });
            base['sid'] = base['sid'] ?? parent?.sid;
            base['uid'] = base['uid'] ?? parent?.uid;
        }
        return base;
    }
}

/**
 * class: `MyProxy`
 * - common parent of manager-proxy.
 */
export class MyManagerProxy<
    MyModel extends CoreModel<ModelType>,
    MyManager extends MyCoreManager<MyModel, ModelType, MyService>,
    MyService extends MyCoreService<MyModel, ModelType, any>,
    ModelType extends string = string,
> extends ManagerProxy<MyModel, MyManager, ModelType> {
    public constructor(readonly proxy: MyCoreProxy<ModelType, MyService>, mgr: MyManager) {
        super(proxy, mgr);
    }

    /**
     * @override the default `normal()` to support _name.
     */
    public normal = (N: MyModel): MyModel =>
        Object.keys(N || {}).reduce<MyModel>((M, k) => {
            //NOTE - imporved of basic `normal()` in core not to ignore `_` properties.
            if (k == '_id' || !this.$mgr.FIELDS.includes(k)) return M;
            const v = N[k as keyof MyModel];
            //! `null` 은 DynamoDB에서 비어있는 문자임.
            (M as any)[k] = v === null ? '' : v;
            return M;
        }, {} as any);

    /**
     * pack the query parameter for list
     * - `param` has the string values only including '', '!'
     * - `model` has the valid data type. (number | string | ... )
     *
     * ```ts
     * let model = bodyToModel(param)
     * ```
     *
     * @param param the original query parameter.
     * @param model the transformed model from `param`.
     * @param options (optional)
     * @returns
     */
    public packSearchParam(
        param: SimpleSet,
        model?: MyModel,
        options?: {
            /** flag to use session-token (default false) */
            useSession?: boolean;
            /** flag to throw error (default true) */
            throwable?: boolean;
            /** default limit (default 10) */
            limit?: number;
        },
    ) {
        const $page: PaginateParam = {};
        const $ctx = this.proxy.context;
        const type = this.$mgr.type;
        const useSession = options?.useSession ?? false;
        const throwable = options?.throwable;
        const isLocal = $ctx?.domain === 'localhost';
        const session = useSession ? this.proxy.getCurrentSession({ throwable }) : null;

        const _has = (name: string): boolean =>
            param && (typeof param[name] === 'string' || typeof param[name] === 'number');
        const _val = (name: string): string => (param ? $T.S2(param[name]) : undefined);
        //TODO - extract as function below @241017
        const _isAdm = () => session?.roles?.includes('admin');

        // parse params
        const limit = $T.N(param?.limit, options?.limit ?? 10);
        const page = $T.N(param?.page, 0);
        const sort = _has('sort') ? $T.S2(param?.sort, '') : undefined;
        if (page < 0) throw new Error(`@page[${page}] is invalid - doList(${type})`);
        Object.assign($page, onlyDefined({ page, limit, sort }));

        // extract filtering by properties.
        // WARN - has no internal properties like { sid, gid, uid }
        const $param: SearchParam<MyModel> = this.$mgr.FIELDS.reduce((M: SearchParam<MyModel>, k: string) => {
            const key = k as keyof MyModel;
            const val = model && model[key];
            const qry = param && param[k];
            //* high priorty to param for not transformed field.
            if (qry === '' || qry === '!') (M as any)[key] = qry;
            else if (val !== undefined) (M as any)[key] = val;
            return M;
        }, {} as SearchParam<MyModel>);

        // use w/ `session-token`
        if (useSession && !isLocal) {
            if (_isAdm()) {
                $param['sid'] = _has('sid') ? (_val('sid') === '0' ? _val('sid') : _val('sid')) : session?.sid;
            } else {
                $param['sid'] = session?.sid;
            }
            //* use the current session's uid.
            if (_has('uid')) $param['uid'] = _val('uid') === '0' ? session?.uid : _val('uid');
        } else {
            if (_has('sid')) $param['sid'] = _val('sid');
            if (_has('uid')) $param['uid'] = _val('uid');
        }

        //* returns params.
        return { $page, $param };
    }

    /**
     * override this to validate request'body.
     * @param model model from request.
     * @param modelId (optional) modelId if to update the target model.
     * @return validated model to save.
     */
    public async validateModel<T extends MyModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const validated = await this.$mgr.validateModel(model, $org);
        return validated as T;
    }

    /**
     * callback before saving model.
     * - could change field before saving.
     *
     * @param model the last model to save.
     * @param $org (optional) original model (null if creating)
     */
    public async onBeforeSave(model: MyModel, $org?: MyModel): Promise<MyModel> {
        return model;
    }

    /**
     * callback after saving model.
     * - could trigger the next step if created.
     *
     * @param model the saved model (null if deleted)
     * @param $org (optional) original model (null if new created)
     */
    public async onAfterSave(model: MyModel, $org?: MyModel): Promise<MyModel> {
        return model;
    }

    /**
     * generate the next id
     */
    public async nextId(): Promise<string> {
        return this.$mgr.nextId().then(n => $T.S2(n));
    }

    /**
     * create new model
     * - use `.id` or `nextId()` for model-id
     * - validate model in seperate way before using this.
     *
     * @param model creation model
     * @param validate (optional) flag to validate (default is true)
     */
    public async makeModel(model: MyModel, validate?: boolean): Promise<MyModel> {
        const errScope = `makeModel(${this.$mgr.type}/${model?.id ?? ''})`;
        if (!model) throw new Error(`@model (${this.$mgr.type}-model) is required - ${errScope}`);
        validate = validate ?? true;

        // use the custome id or new generated id.
        const hasId = !!model.id;
        const modelId = hasId ? $T.S2(model.id) : await this.nextId();

        // make default model as base.
        const $def0 = this.$mgr.buildDefault(modelId);
        const $def2 = this.override($def0, model); //! 초기생성(INSERT)에 대부분의 필드값 채워주기.
        const $def3 = validate ? await this.validateModel({ ...$def2, id: modelId }, null) : $def2;

        // overwrite (or update) the model.
        const $org = await this.get(modelId, { ...$def3 });
        if ($org?.id !== modelId) throw new Error(`.id[${model?.id}] is invalid (mismatched ${modelId}) - ${errScope}`);
        return hasId ? this.override($org, $def3) : $org;
    }
}
