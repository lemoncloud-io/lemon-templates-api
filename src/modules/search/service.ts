/**
 * `search-service.ts`
 * - service to provide the low level elastic-search api.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-02-22 optimized w/ `lemon-core#3.0` and `@elastic/elasticsearch`
 * @date        2024-12-20 optimized with `lemon-core#3.2.11`
 *
 * @origin      lemon-templates-api
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { $U, _err, _inf, _log, $protocol, SimpleSet, GETERR, NextContext } from 'lemon-core';
import {
    CoreModelFilterable,
    Elastic6Option,
    GeneralKeyMaker,
    GeneralModelFilter,
    ProxyStorageService,
    StorageMakeable,
    TypedStorageService,
    UniqueFieldManager,
    Elastic6SearchParams,
    Elastic6Instance,
} from 'lemon-core';
import { $T } from 'lemon-core';
import { _OS2 } from 'lemon-core';
import {
    $FIELD,
    SearchBody,
    SearchModel,
    SearchModelType,
    SearchBatchModel,
    SearchQueryModel,
    SearchResult,
} from './model';

const NS = $U.NS('search', 'blue'); // NAMESPACE TO BE PRINTED.

export { Elastic6Option };

/**
 * batch-options
 * - to provide more parameters to batch-handler.
 */
export interface BatchParams<T = any> {
    /**
     * custom meta parameters when starting batch.
     */
    meta?: T;
    /**
     * the current run index.
     */
    index?: number;
    /**
     * the current run context.
     */
    context?: NextContext;
}

/**
 * batch process to process.
 */
export interface BatchHandler<T = any, U = any> {
    /**
     * process each list of batch.
     *
     * @param list the query result list.
     * @param params the running options;
     */
    (list: T[], params?: BatchParams): Promise<U[]>;
}

/**
 * class `SearchService`
 * - to manipulate shared Elasticsearch resources as a singleton
 */
export class SearchService
    extends GeneralKeyMaker<SearchModelType>
    implements StorageMakeable<SearchModel, SearchModelType>
{
    /**
     * Elastic6Instance
     */
    public readonly instance?: Elastic6Instance;

    protected readonly tableName: string;
    protected current: number = 0; // for unit-test. set the current time-stamp.

    public readonly $query: MyQueryManager;
    public readonly $batch: MyBatchManager;

    /**
     * lookup for batch-handler.
     */
    protected readonly handlers: { [key: string]: BatchHandler } = {
        stop: () => Promise.reject(new Error('always stopped at calling!')),
        echo: (list: []) => Promise.resolve(list),
    };

    /**
     * constructor
     */
    public constructor(tableName: string, ns: string, options: Elastic6Option) {
        super(ns);
        _log(NS, `SearchService(${tableName}, ${ns})..`);
        this.tableName = tableName;
        const $es6 = _OS2(options);
        this.instance = $es6;
        this.$query = new MyQueryManager(this);
        this.$batch = new MyBatchManager(this);
    }

    /** get the current `options` (nullable) */
    public get options() {
        return this.instance?.elastic?.options;
    }

    /**
     * the current information
     */
    public hello = () => `search-service:${this.NS}/${this.tableName ?? ''}/${this.options?.indexName ?? ''}`;

    /** override current */
    public setCurrent = (current: number) => (this.current = current);

    /**
     * check if search is running over proxy.
     */
    public isProxy(): boolean {
        return !!this.instance?.hello().startsWith('Elastic6Proxy');
    }

    /**
     * get internal `_id` by primary keys.
     * @param type  model-type
     * @param id    node-id (or sequence)
     */
    public asKey(type: SearchModelType, id: string | number): string {
        const $key = this.asKey$(type, `${id || ''}`);
        return $key._id;
    }

    /**
     * set batch-handler by name.
     */
    public setBatchHandler(name: string, handler: BatchHandler) {
        name = `${name || ''}`;
        if (typeof handler !== 'function') throw new Error(`@handler (function) is required!`);
        this.handlers[name] = handler;
    }

    /**
     * execute batch-handler, and get the results.
     */
    public async runBatchHandler<T = any>(name: string, list: T[], params?: BatchParams) {
        name = `${name || ''}`;
        _log(NS, `runBatchHandler(${name})`);
        try {
            const fx = this.handlers[name];
            if (!fx || typeof fx !== 'function') throw new Error(`@name[${name}] (batch-handler) is invalid!`);
            const ret = fx(list, params);
            if (ret instanceof Promise) return ret;
            return Promise.resolve(ret);
        } catch (e) {
            _err(NS, `! batch-handler[${name}].err =`, GETERR(e));
            return Promise.reject(e);
        }
    }

    //TODO - imporve later to support multi get.
    // /**
    //  * multi get by id
    //  *
    //  * @param _ids  _id list
    //  */
    // public async mget<T>(_ids: string[]): Promise<(T | null)[]> {
    //     const client?: elasticsearch.Client = this.instance.client;
    //     const $res = await this.client.mget({
    //         index: this.options.indexName,
    //         type: this.options.docType,
    //         body: {
    //             docs: _ids.map(_id => ({ _id })),
    //         },
    //     });
    //     // _log(NS, `> res =`, $U.json({ ...$res, meta: undefined }));
    //     const { docs } = $res.body;
    //     const idName = this.options.idName; // id of elastic-search.
    //     return docs.map((doc: any) => (doc.found ? sourceToItem<T>(doc._source, idName) : null));
    // }

    /**
     * search by raw query
     *
     * @param body      Elasticsearch Query DSL
     * @param params    (optional) search parameters.
     */
    public async search<T>(body: SearchBody, params?: Elastic6SearchParams): Promise<SearchResult<T>> {
        if (!this.instance) throw new Error(`.instance is invalid (mis-config)`);
        return this.instance.search(body, params);
    }

    /**
     * search all until limit (-1 means no-limit)
     */
    public async searchAll<T>(body: SearchBody, params?: Elastic6SearchParams, limit: number = -1) {
        const list: T[] = [];
        for await (const chunk of this.generateSearchResult(body, params, limit)) {
            chunk.forEach((N: T) => list.push(N));
        }
        return list;
    }

    /**
     * create async generator that yields items queried until last
     *
     * @param body      Elasticsearch Query DSL
     * @param params    (optional) search parameters.
     * @param limit     the maximum limit of loop (-1 means un-limited)
     */
    public async *generateSearchResult<T>(body: SearchBody, params?: Elastic6SearchParams, limit?: number) {
        if (!body.sort) body.sort = '_doc';

        do {
            const { list, last } = await this.search<T>(body, params);
            body.search_after = last;

            yield list;
        } while (body.search_after && (limit === -1 || --limit > 0));
    }

    /**
     * create storage-service w/ fields list.
     * - idName should be `_id`
     */
    public makeStorageService<T extends SearchModel>(
        type: SearchModelType,
        fields: string[],
        filter: CoreModelFilterable<T>,
    ) {
        const table = this.tableName;
        //! use proxy-storage-service for both dynamo-table and dummy-data.
        const storage = new ProxyStorageService<T, SearchModelType>(this, table, fields, filter);
        storage.setTimer(() => (this.current ? this.current : new Date().getTime()));
        const service = storage.makeTypedStorageService(type);
        return service;
    }

    /** show the stat of this index */
    public async showIndexStat() {
        const { list } = await this.instance.elastic.listIndices();
        const item = list?.find(N => N.index == this.options.indexName);
        const _mb = (s: string) => {
            if (s?.endsWith('kb')) return $U.F(s.substring(0, s.length - 2)) / 1000.0;
            if (s?.endsWith('mb')) return $U.F(s.substring(0, s.length - 2));
            if (s?.endsWith('gb')) return $U.F(s.substring(0, s.length - 2)) * 1000;
            if (s?.endsWith('tb')) return $U.F(s.substring(0, s.length - 2)) * 1000 * 1000;
            return 0;
        };
        // return.
        return { ...item, priStoreSizeMb: _mb(item?.priStoreSize), storeSizeMb: _mb(item?.storeSize) };
    }
}

/**
 * class: `MySearchCoreManager`
 * - shared core manager for all model.
 * - handle 'name' like unique value in same type.
 */
// eslint-disable-next-line prettier/prettier
export class MySearchCoreManager<T extends SearchModel, S extends StorageMakeable<T, SearchModelType>> extends GeneralModelFilter<T, SearchModelType> {
    public readonly parent: S;
    public readonly type: SearchModelType;
    public readonly storage: TypedStorageService<T, SearchModelType>;
    public readonly $unique: UniqueFieldManager<T, SearchModelType>;
    public constructor(type: SearchModelType, parent: S, fields: string[], uniqueField?: string) {
        super(fields);
        if (uniqueField && uniqueField !== 'name')
            throw new Error(`@uniqueField[${uniqueField}] is invalid - use name only!`);
        this.parent = parent;
        this.type = type;
        this.storage = parent.makeStorageService(type, fields, this);
        this.$unique = uniqueField ? this.storage.makeUniqueFieldManager(uniqueField) : null;
    }

    /**
     * say hello
     */
    public hello = () => `${this.storage.hello()}`;

    /**
     * override `super.onBeforeSave()`
     */
    public onBeforeSave(model: T, origin: T): T {
        //NOTE! - not possible to change name in here.
        if (origin && origin.name) delete model.name;
        return model;
    }

    /**
     * get model by id
     */
    public async getModelById(id: string): Promise<T> {
        return this.storage.read(id).catch(e => {
            if (`${e.message}`.startsWith('404 NOT FOUND')) throw new Error(`404 NOT FOUND - ${this.type}:${id}`);
            throw e;
        });
    }

    /**
     * validate id format
     * - must be the number format
     */
    public validateId = (id: string, throwable = false): boolean => {
        id = `${id || ''}`.trim();
        const $re = /^[1-9][0-9]+$/;
        const valid = $re.test(id);
        if (throwable && !valid) throw new Error(`@id[${id}] is invalid format - type:${this.type}`);
        return valid;
    };

    /**
     * validate name format
     * - just check empty string.
     * - use only alphabets(lower-case only)
     * @param name unique name in same type group.
     */
    public validateName = (name: string, throwable = false): boolean => {
        const $re = /^([a-z]|[a-z]+[a-z0-9\-]*[a-z0-9])$/;
        const valid = this.$unique ? $re.test(name) && this.$unique.validate(name) : true;
        if (throwable && !valid) throw new Error(`@name[${name}] is invalid format - type:${this.type}`);
        return valid;
    };

    /**
     * convert to internal id by name
     * @param name unique name in same type group.
     */
    public asIdByName = (name: string): string => (this.$unique ? this.$unique.asLookupId(name) : null);

    /**
     * lookup model by name
     * - use `stereo` property to link with the origin.
     *
     * @param name unique name in same type group.
     */
    public findByName = async (name: string): Promise<T> => {
        if (this.$unique) return this.$unique.findOrCreate(name);
        throw new Error(`400 NOT SUPPORT - ${this.type}:#${name}`);
    };

    /**
     * save model by name (or create)
     *
     * @param name unique name of entity.
     * @param model mdoel to save.
     * @returns the updated model
     */
    public saveByName = async (name: string, model: T) => {
        this.validateName(name, true);
        const type = this.type;
        const $def: SearchModel = { type, name };
        const $org = await this.$unique.findOrCreate(name, $def as T);
        return this.storage.update($org.id, model);
    };

    /**
     * update `name` of model
     * - save the origin id into `stereo` property.
     *
     * @param model target model
     * @param name  new name of model.
     */
    public updateName = async (model: T, name: string): Promise<T> => {
        if (!this.validateName(name)) throw new Error(`@name (${name || ''}) is not valid!`);
        if (this.$unique) {
            // STEP.1 try to update loockup 1st.
            const $map = await this.$unique.updateLookup(model, name);
            _log(NS, `> lookup[${model.id}].res =`, $U.json($map));

            // STEP.3 update the name of origin.
            const $upt: SearchModel = { name };
            const updated = await this.storage.update(model.id, $upt as T);
            _log(NS, `> update[${model.id}].res =`, $U.json(updated));

            // FINAL. returns the updated model
            model.name = name;
            model.updatedAt = updated.updatedAt || model.updatedAt;
            return model;
        }
        throw new Error(`400 NOT SUPPORT - ${this.type}:#${name}`);
    };
}

/**
 * class: `MyQueryManager`
 * - manager for search-query model.
 */
class MyQueryManager extends MySearchCoreManager<SearchQueryModel, SearchService> {
    public constructor(parent: SearchService) {
        super('#query', parent, $FIELD.$query, 'name');
    }

    /**
     * read and convert query object to SearchBody
     *
     * @param query string
     * @param body (optional) request body(as simple-set) to replace `{{key}}` in query string.
     * @returns SearchBody
     */
    public asQuery(query: string, body?: SimpleSet): SearchBody {
        if (!query) return null;
        if (query && typeof query !== 'string') throw new Error(`@query<${typeof query}> is invalid`);
        const _pick = (key: string, txt?: string) => {
            const val = body ? body[key] : null;
            if (val === undefined) throw new Error(`.${key} (key in body) is required for query ${txt || ''}!`);
            return val === 0 ? '0' : `${val || ''}`;
        };
        query = query.replace(/\{\{(\w+)\}\}/g, (a, b) => _pick(b, a));
        const obj = query.startsWith('{') && query.endsWith('}') ? JSON.parse(query) : null;
        if (!obj) throw new Error(`@query[${query}] is invalid format!`);
        // last 에 대한 특별한 처리하기..
        const search = obj as SearchBody;
        if (body?.last && typeof body?.last === 'string') {
            const last = $T.SS(body.last).map(s => (/^[1-9][0-9]*$/.test(s) ? $T.N(s) : s));
            search.search_after = last;
        } else if (body?.last && Array.isArray(body?.last)) {
            search.search_after = body?.last;
        }
        if (search.search_after) _inf(NS, `>> search.search_after =`, search.search_after?.join(', '));
        //! returns finally.
        return search;
    }

    /**
     * read query by name
     */
    public async readQuery(name: string): Promise<SearchBody> {
        const $org = await this.findByName(name);
        return this.asQuery($org.query);
    }

    /**
     * save query into storage.
     */
    public async saveQuery(name: string, body: SearchBody) {
        //! save by name.
        if (!body?.query || typeof body?.query !== 'object') throw new Error(`.query (SearchBody.query) is required!`);
        const query = $U.json(body);
        const saved = await this.saveByName(name, { query });
        _log(NS, `> query[${saved._id}].saved =`, $U.json(saved));
        return { ...saved, Query: this.asQuery(query) };
    }

    /**
     * merge and update the search-body into `.query`
     */
    public async updateQuery(model: SearchQueryModel, body: SearchBody) {
        const prev = typeof model.query === 'string' ? this.asQuery(model.query) : model.query;
        const new2: SearchBody = { ...prev, ...body };
        const query = $U.json(new2);
        const id = model.id;
        const updated = await this.storage.update(model.id, { query });
        return { ...updated, id, Query: this.asQuery(updated.query) };
    }
}

/**
 * class: `MyBatchManager`
 * - manager for search-query model.
 */
class MyBatchManager extends MySearchCoreManager<SearchBatchModel, SearchService> {
    public constructor(parent: SearchService) {
        super('#batch', parent, $FIELD.$batch, 'name');
    }

    /**
     * find(or create) the batch-model for query.
     *
     * @param query the linked query.
     * @param name (optional) batch-name (default same as query.name, '' will create new)
     */
    public async findBatch(query: SearchQueryModel, name?: string): Promise<SearchBatchModel> {
        _log(NS, `createBatch(${query?.id}, ${name})`);
        name = name === '' ? '' : `${name || query?.name || ''}`;
        // STEP.0 validate parameter.
        const queryId = query?.id;
        if (!queryId) throw new Error(`@query.id is required!`);

        // STEP.1 prepare(or find) model
        const model =
            name && name !== '#'
                ? await this.$unique.findOrCreate(name, { name })
                : await this.storage.insert({ name: '#', queryId });

        // STEP.2 validate `.queryId`
        if (model?.queryId && model?.queryId != queryId)
            throw new Error(`.queryId[${model?.queryId}] is not matched - expected:${queryId}`);

        // FINAL. returns.
        return model;
    }

    /**
     * create (or find) the batch-model for query.
     * - make it as initial state.
     *
     * @param query query-model to use
     * @param name (optional) unique name
     */
    public async createBatch(query: SearchQueryModel, name?: string, target?: string): Promise<SearchBatchModel> {
        _log(NS, `createBatch(${query?.id}, ${name})`);
        const queryId = query?.id;
        const model = await this.findBatch(query, name);

        // STEP.1 make initial state.
        const $ups: SearchBatchModel = { state: 'initial', started: 0, size: 0, batch: '', error: '' };
        if (model.queryId != queryId) $ups.queryId = queryId;
        if (target) $ups.target = target;

        // STEP.2 update as initial state.
        const updated = await this.storage.update(model.id, { ...$ups });
        _log(NS, `> updated[${model.id}] =`, $U.json(updated));

        // FINAL. returns.
        return { ...model, ...updated, id: model.id };
    }

    /**
     * transform meta to object
     */
    public asMeta$ = (meta: string | any): SimpleSet => {
        if (typeof meta === 'object') return { ...meta };
        else if (typeof meta === 'string') {
            if (meta.startsWith('{') && meta.endsWith('}')) return JSON.parse(meta);
            else if (meta.startsWith('[') && meta.endsWith(']')) return { list: JSON.parse(meta) };
            else return { meta };
        } else {
            return { meta };
        }
    };

    /**
     * schedule the next run via queue.
     */
    public enqueueNext = async ($batch: SearchBatchModel, $ctx: NextContext): Promise<string> => {
        const batchId = $batch?.id;
        const service = `//self/search/${batchId}/run-batch-next`;
        const count = $U.N($batch.count);
        const qid = await $protocol($ctx, service).enqueue({ count }, null, 'POST');
        return `run-batch-next:${qid || ''}`;
    };
}

// /**
//  * single shared instance.
//  */
// export default new SearchService();
