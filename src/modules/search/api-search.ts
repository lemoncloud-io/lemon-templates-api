/**
 * `search-api.ts`
 * - common service for `search`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2022-02-18 optimized search w/ ES6.8
 * @date        2024-12-20 optimized with `lemon-core#3.2.11`
 *
 * @origin      lemon-templates-api
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $T, $U, _log, _inf, _err, NUL404, GETERR, $info, $slack } from 'lemon-core';
import {
    NextHandler,
    GeneralWEBController,
    loadJsonSync,
    doReportError,
    Elastic6SearchParams,
    SearchProxyBody,
} from 'lemon-core';
import { SearchBatchModel, SearchBody, SearchResult, SearchQueryModel } from './model';
import { $ES6, _OS2 } from '../../cores/abstract-services';
import { BatchParams, SearchService } from './service';
import { performance } from 'perf_hooks';

//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService } from '../../service/backend-service';
const NS = $U.NS('search', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `SearchAPIController`
 * - handler for `/search/` api
 */
export class SearchAPIController extends GeneralWEBController {
    protected service: BackendService;
    protected search: SearchService;

    /**
     * default constructor.
     */
    public constructor(service?: BackendService, search?: SearchService) {
        super('search');
        _log(NS, `SearchController()...`);
        this.service = service ?? $service;
        this.search = search ?? $service.search;
    }

    /**
     * say hello()
     */
    public hello = (): string => `search-api:${this.type()}`;

    /**
     * find the target model by id or name
     */
    protected findQueryModel = async (id: string): Promise<SearchQueryModel> => {
        if (!this.search) throw new Error(`.service (SearchService) is required - search!`);
        let model: SearchQueryModel = null;
        if (this.search.$query.validateId(id)) {
            model = await this.search.$query.getModelById(id);
        } else if (this.search.$query.validateName(id)) {
            model = await this.search.$query.findByName(id);
        } else throw new Error(`404 NOT FOUND - find-model(${this.search.$query.type}/${id})`);

        //! return model.
        return { ...model, Query: model.query ? JSON.parse(model.query) : null };
    };

    protected findQuery = async (id: string): Promise<SearchBody> => {
        const model = await this.findQueryModel(id);
        const query = this.search.$query.asQuery(model.query);
        return query;
    };

    protected runQuery = async (body: SearchBody, size?: number) => {
        _log(NS, `runQuery(${size})..`);
        if (size !== undefined) return this.search.search({ ...body, size: $U.N(size, 0) });
        return this.search.search(body);
    };

    /**
     * GET /search/{id}/hello
     * - internal management of search index
     */
    public getSearchHello: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `getSearchHello(${id ?? ''})`;
        id = id == '0' ? '' : id;
        const isLocal = $ctx?.domain === 'localhost';
        if (!isLocal) throw new Error(`403 NOT ALLOWED - domain[${$ctx?.domain ?? ''}] is invali  @${errScope}`);

        const hello = this.hello();
        const useProxy = this.search?.isProxy(); // flag if search is running w/ proxy agent.
        const runProxy = (cmd: string) => this.search.instance.search(null, { indexName: `#${cmd}` });
        const $elastic = this.search?.instance?.elastic;

        //! $ http ':8800/search/init-elastic/hello'
        if (id == 'init-elastic') return useProxy ? runProxy('create-index') : $elastic?.createIndex();
        //! $ http ':8800/search/destroy-elastic/hello'
        if (id == 'destroy-elastic') return useProxy ? runProxy('destroy-index') : $elastic?.destroyIndex();
        //! $ http ':8800/search/desc-elastic/hello'
        if (id == 'desc-elastic') return useProxy ? runProxy('describe-index') : $elastic?.describe();

        return { id, hello };
    };

    /**
     * Search by params
     *
     * ```sh
     * $ http ':8800/search/'
     * $ http ':8800/search/?name=test'
     * $ http ':8800/search?page=2'
     * $ http ':8800/search/ticket?page=2'
     */
    public listSearch: NextHandler = async (id, param) => {
        _log(NS, `listSearch(${id})....`);
        param = param || {};

        //! translate page + ipp => page & limit.
        const $page = $U.N(param.page, 0);
        const $limit = $U.N(param.limit, $U.N(param.ipp, 3)); //! compartible for ipp
        const $param = { ...param, $page, $limit, page: undefined, ipp: undefined, limit: undefined };
        const res = await (async () => {
            if (id) throw new Error(`404 NOT FOUND - invalid index: ${id}`);
            //TODO - opt below `$ES6.query.searchSimple` w/ `$OS2`
            return $ES6.query.searchSimple($param);
        })();

        //! returns with page + ipp.
        return { ...res, page: $page, ipp: $limit };
    };

    /**
     * GET /search/{name|id}
     * - show the current query by { name | id }
     *
     * ```sh
     * $ http :8800/search/0
     * $ http :8800/search/1000002
     */
    public getSearch: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `getSearch(${id})..`);
        param && _log(NS, `> param = `, $U.json(param));
        body && _log(NS, `> body = `, $U.json(body));
        id = id == '0' ? '' : id;
        // if (!id) throw new Error(`@id (string) is required!`);
        if (!id) throw new Error(`404 NOT FOUND - id is required!`);
        return this.findQueryModel(id);
    };

    /**
     * GET /search/{name|id}
     * - show the current query by { name | id }
     *
     * ```sh
     * $ http :8800/search/0
     * $ http :8800/search/prods-not-matched/batch
     */
    public getSearchBatch: NextHandler = async (id, param, body, ctx) => this.postSearchBatch(id, param, body, ctx);
    public postSearchBatch: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `postSearchBatch(${id})..`);
        param && _log(NS, `> param = `, $U.json(param));
        body && _log(NS, `> body = `, $U.json(body));
        id = id === '0' ? '' : $T.S(id);
        if (!id) throw new Error(`@id (batch-id) is required!`);
        const restart = !!$T.B(param?.restart, param?.restart === '' ? 1 : 0);
        const $query = await this.findQueryModel(id);
        _log(NS, `> $query =`, $U.json($query));
        _log(NS, `> batch-id =`, $query.batchId);
        const $batch = $query.batchId ? await this.search.$batch.getModelById($query.batchId) : null;
        if (restart && $batch) {
            const size = $T.N(param?.size, $batch.size);
            const limit = $T.N(param?.limit, $batch.limit);
            const target = $batch.target;
            const restarted = await this.postSearchStartBatch(id, { target, size, limit }, {}, ctx);
            _inf(NS, `> restarted =`, $U.json(restarted));
        }
        return { ...$batch, $query, id: $T.S($batch?.id, '') };
    };

    /**
     * run query, and get the search results. (GET/POST)
     *
     * ```sh
     * $ http :8800/search/echo/query
     * $ http :8800/search/1000002/query
     * $ http :8800/search/events-in-valid/query
     * $ http :8800/search/mappings-no-hash-option/query
     * $ http :8800/search/mappings-has-hash-option/query
     * $ http :8800/search/texts-has-not-norm1/query
     * $ http :8800/search/texts-only-if-norm1/query
     * $ http :8800/search/norm1-has-not-rule1/query
     * $ http :8800/search/mappings-no-norm1-prio/query
     * $ http POST :8800/search/1000002/query
     * $ http POST :8800/search/mappings-no-norm1-prio/query priority=2
     */
    public getSearchQuery: NextHandler = async (id, param, body, $ctx) => this.postSearchQuery(id, param, body, $ctx);
    public postSearchQuery: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `postSearchQuery(${id ?? ''})`;
        _log(NS, `${errScope}..`);
        // param && _log(NS, `> param = `, $U.json(param));
        // body && _log(NS, `> body = `, $U.json(body));
        $ctx && _log(NS, `> $ctx = `, $U.json($ctx));
        id = id === '0' ? '' : $T.S2(id);
        // if (id) throw new Error(`@id[${id}] is invalid - ${errScope}`);
        if (!id) throw new Error(`@id[${id}] is required - ${errScope}`);

        const verbose = !!$T.B(param?.v, param?.v === '' ? 1 : 0);
        const size = $T.N(param?.size || body?.size, 1);
        const { query } = await this.findQueryModel(id);
        const $query = this.search.$query.asQuery(query, { ...body, ns: this.search.NS });
        const $res = await this.runQuery($query, size);
        if (verbose) {
            const _fx = (O: any): any =>
                Array.isArray(O)
                    ? O.map(N => _fx(N))
                    : O && typeof O !== 'object'
                    ? O
                    : Object.keys(O).reduce<any>((O, k) => {
                          const v = (O as any)[k];
                          if (typeof v === 'number' && v > 1600285566070) (O as any)[k] = $U.ts(v);
                          else if (v && typeof v === 'object') (O as any)[k] = _fx(v);
                          return O;
                      }, O);
            return _fx($res);
        }
        return { ...$res, $query };
    };

    /**
     * run the proxied search query.
     */
    public getSearchProxy: NextHandler<Elastic6SearchParams, any, SearchProxyBody> = async (id, param, body, $ctx) =>
        this.postSearchProxy(id, param, body, $ctx);
    public postSearchProxy: NextHandler<Elastic6SearchParams, any, SearchProxyBody> = async (id, param, body, $ctx) => {
        const errScope = `postSearchProxy(${id ?? ''})`;
        _log(NS, `${errScope}..`);
        id = id === '0' ? '' : $T.S2(id);

        //* (internal) for loop testing.
        if (param?.indexName === '#echo') {
            const context = { identity: { ...$ctx?.identity } };
            return { param, body, context };
        }

        //NOTE - prevent the infite loop to use `search-proxy`
        // http POST :8800/search/0/proxy
        const $es6 = this.search?.instance;
        if (this.search?.isProxy()) {
            throw new Error(`.search[${$es6?.hello()}] is invalid (should not in proxy) - ${errScope}`);
        }

        // STEP.0 validate parameters.
        if (1) {
            const options = this.search.options;
            const indexName = $T.S(options?.indexName);
            const service = $T.S($info()?.service);
            if (service !== body?.service)
                throw new Error(`.service[${body?.service ?? ''}] is invalid (mismatched) - ${errScope}`);
            if (indexName !== body?.index && !body?.index?.startsWith('#'))
                throw new Error(`.index[${body?.index ?? ''}] is invalid (mismatched) - ${errScope}`);
        }

        //* runs in guarded proxy.
        return this.service.guardProxy($ctx, async proxy => {
            // STEP.1 validate access (valid ONLY if signed w/o identity-pool).
            const isPassed = proxy.assertContext({ isSigned: true, isAuthed: false }, { throwable: false });
            if (!isPassed) throw new Error(`403 NOT ALLOWED - invalid credential @${errScope}`);

            //! decode by `#<cmd>`.
            const indexName = $T.S2(param?.indexName);
            const cmd = indexName.startsWith('#') ? indexName.substring(1) : null;
            if (cmd && !$es6?.elastic) {
                throw new Error(`.elastic(object) is required (mis-configuration) - ${errScope}`);
            } else if (cmd === 'create-index') {
                return await $es6.elastic?.createIndex();
            } else if (cmd === 'destroy-index') {
                return await $es6.elastic?.destroyIndex();
            } else if (cmd === 'describe-index') {
                return await $es6.elastic?.describe();
            } else if (cmd !== null) {
                throw new Error(`@cmd[${cmd}] is invalid (not-supported) - ${errScope}`);
            }

            // STEP.2 extract body. (warning! beware of infinite loooop)
            const $body = body?.body && typeof body?.body === 'object' ? body?.body : undefined;
            if (!$body) throw new Error(`.body(SearchBody) is required - ${errScope}`);

            // STEP.3 execute query..
            const $res = await $es6.search($body, param);
            _log(NS, `> total =`, $res?.total);
            return $res;
        });
    };

    //TODO - support `/export`
    // /**
    //  * run query, and get the search results. (POST)
    //  *
    //  * ```sh
    //  * $ http POST ':8800/search/norm1-has-not-rule1/export?size=1&limit=2'
    //  *
    //  * # 정규화(1차) 텍스트 정보 저장하기.
    //  * $ http POST ':8800/search/texts-only-if-norm1/export?size=200&limit=150'
    //  * $ http POST ':8800/search/texts-only-if-norm1/export?size=200&limit=150' last=1640227180722
    //  */
    // public postSearchExport: NextHandler = async (id, param, body, ctx) => {
    //     _log(NS, `postSearchExport(${id})..`);
    //     param && _log(NS, `> param = `, $U.json(param));
    //     body && _log(NS, `> body = `, $U.json(body));
    //     id = id == '0' ? '' : id;

    //     // STEP.0 validate paramters..
    //     const multi = !!$T.N(param?.multi, param?.multi === '' ? 1 : 0); // generate multi files.
    //     const size = Math.min(1000, $T.N(param?.size, 1));
    //     const limit = Math.min(1000, param?.limit === '' ? -1 : $T.N(param?.limit, 1)); // -1 means 'no-limit'
    //     const TEMP = $U.env('TEMP', '') || './temp';

    //     // STEP.1 build query.
    //     const { query } = await this.findQueryModel(id);
    //     const $query = this.service.$query.asQuery(query, { ...body, ns: this.service.NS });

    //     // STEP.2 run query until limit (or EOF)
    //     let list: any[] = [];
    //     let index = 0;
    //     const asPath = (index: number) => `${TEMP}/${id}_${index.toString().padStart(3, '0')}.csv`;
    //     const saveCsv = (list: GeneralItem[], index: number = 0) => new Csv(list).saveToFile(asPath(index));
    //     const ATTRS: { [key: string]: string } = {
    //         'texts-only-if-norm1': 'id,text,rule1,unit,color,note,code,size,size1,error,createdAt',
    //     };
    //     const attrs = ATTRS[id]?.split(',') || [];
    //     const convert = (N: any) =>
    //         attrs.reduce((M: any, key) => {
    //             M[key] = N[key] === undefined ? null : N[key];
    //             return M;
    //         }, {});
    //     for await (const chunk of this.service.generateSearchResult({ ...$query, size }, undefined, limit)) {
    //         index++;
    //         _log(NS, `> [${index}].len =`, chunk?.length);
    //         //! 1번째 chunk에서 가장긴 attribute 속성 구하기..
    //         if (index === 1 && attrs.length === 0) {
    //             chunk
    //                 .map(N => Object.keys(N))
    //                 .reduce((L: string[], N) => (N.length > L.length ? N : L), [])
    //                 .map(k => (k.startsWith('_') || k.startsWith('$') ? null : attrs.push(k)));
    //         }
    //         //! attrs 값을 기준으로 데이터를 뽑아낸다.
    //         list = (multi ? [] : list).concat(chunk.map(convert));
    //         if (multi) await saveCsv(list, index);
    //     }
    //     if (!multi) await saveCsv(list, index);
    //     // const $res = await this.runQuery($query, size);
    //     return { list: list.slice(0, 10), $query, index, size, limit };
    // };

    /**
     * POST /search/{name|id}
     * - insert (or update) the current query
     *
     * ```sh
     * $ http POST :8800/search/events-in-valid
     * $ http POST :8800/search/accounts-in-valid
     */
    public postSearch: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `postSearch(${id})..`);
        param && _log(NS, `> param = `, $U.json(param));
        body && _log(NS, `> body = `, $U.json(body));
        id = id === '0' ? '' : $T.S(id, '');

        // STEP.1 find body
        body = Object.keys(body).length > 0 ? body : $U.cleanup(loadJsonSync(`data/batch/${id}.json`));

        // STEP.2 save query
        if (!id) {
            //! insert new, and update
            const model = await this.search.$query.storage.insert({ name: '#' });
            return this.putSearch(model.id, param, body, ctx);
        } else if (this.search.$query.validateId(id)) {
            //! update the existing one.
            return this.putSearch(id, param, body, ctx);
        } else if (this.search.$query.validateName(id)) {
            //! update the existing one by name.
            const model = await this.search.$query.saveQuery(id, body);
            return model;
        }
        throw new Error(`@id[${id}] (query-id) is invalid!`);
    };

    /**
     * PUT /search/{name|id}
     * - update the current query
     *
     * ```sh
     * $ http PUT :8800/search/1000001 size=1
     */
    public putSearch: NextHandler = async (id, param, body, ctx) => {
        _log(NS, `putSearch(${id})..`);
        param && _log(NS, `> param = `, $U.json(param));
        body && _log(NS, `> body = `, $U.json(body));
        id = id == '0' ? '' : id;

        // STEP.0 validate param..
        if (!body || typeof body !== 'object') throw new Error(`@body<${typeof body}> is invalid!`);

        //! filter out '$' special key.
        body = Object.keys(body).reduce((M: any, key) => {
            if (key != '$' && key != '_') M[key] = body[key];
            return M;
        }, {});

        // STEP.1 find the existing query.
        const $org = await this.findQueryModel(id);

        // STEP.2 update the query body..
        return this.search.$query.updateQuery($org, body);
    };

    /**
     * start batch with search-query.
     * - `id` 에는 실행할 쿼리의 ID
     * - `body`는 메타 정보로, query {{key}} 를 적용하거나, handler실행시 파라미터로 지정됨.
     *
     * @param param the batch parameters.
     * @param body the meta object to replace query {{key}}
     *
     * ```sh
     * $ http POST ':8800/search/events-in-valid/start-batch?size=10&limit=1&target=extend-expired-at'
     */
    public postSearchStartBatch: NextHandler = async (id, param, body, $ctx) => {
        _log(NS, `postSearchStartBatch(${id})..`);
        param && _log(NS, `> param = `, $U.json(param));
        body && _log(NS, `> body = `, $U.json(body));
        id = id === '0' ? '' : $T.S(id).trim();
        if (!id) throw new Error(`@id (query-id) is required!`);

        // STEP.0 validate param..
        const name = $T.S(param?.name, param?.name === '' ? '#' : ''); // (optional) target batch-name. use '' to create new.
        const stop = !!$T.B(param?.stop, param?.stop === '' ? 1 : 0); // flag to stop the current runs.
        const slack = $T.B(param?.slack, param?.slack === '' ? 1 : 1); // flag to report via slack.
        // const size = $T.N(param?.size, 0); // batch size (if result.length==0, then EOF)
        // const limit = $T.N(param?.limit, 0); // max limit (-1 means doing until EOF)
        const target = $T.S(param?.target, ''); // the target of batch-handler.
        if (!body || typeof body !== 'object') throw new Error(`@body<${typeof body}> is invalid - expected: object!`);

        // STEP.1 find the existing query.
        const $query = await this.findQueryModel(id);
        const meta = { ...body, ns: this.search.NS }; // replace query-template
        const query = this.search.$query.asQuery($query.query, meta);

        // STEP.2 make batch-model, and update the state.
        const $batch = name
            ? await this.search.$batch.createBatch($query, name, target)
            : await this.search.$batch.findBatch($query);
        const hasStopped = $batch.state != 'running';
        const size = $T.N(param?.size, $batch.size || 0); // batch size (if result.length==0, then EOF)
        const limit = $T.N(param?.limit, $batch.limit || 0); // max limit (-1 means doing until EOF)
        const $ups: SearchBatchModel = { batch: $U.json({ query }), meta: $U.json(meta), size, limit, slack };
        const $inc: SearchBatchModel = { started: 0 };
        // STEP.2-1 update the properties in fly.
        if (target) $ups.target = target;
        if (stop) {
            $ups.state = 'initial';
            $ups.started = 0; //! reset this, will stop in next-run.
            delete $inc.started;
        } else if (hasStopped) {
            $ups.state = 'start';
            $ups.count = 0; // reset will make to ignore of queue in busy.
            $ups.error = '';
            $ups.started = 1;
            delete $inc.started;
        } else {
            $inc.started = 1;
        }
        // STEP.3 update storage.
        const qid = $query.id;
        const bid = $batch.id;
        _inf(NS, `> updates[${bid}] =`, $U.json($ups));
        const updated = await this.search.$batch.storage.update(bid, $ups, $inc);
        _inf(NS, `> updated[${bid}] =`, $U.json(updated));
        Object.assign($batch, { ...updated, id: bid });

        // STEP.4 enquene batch-task if not in queue.
        const queueId = updated.started === 1 ? await this.search.$batch.enqueueNext($batch, $ctx) : null;
        queueId && _inf(NS, `> queue-id =`, queueId);

        // STEP.4-1 also update the last batch/queue-id to query.
        if (qid && bid && queueId) {
            const upds = await this.search.$query.storage.update(qid, { batchId: bid, queueId });
            _inf(NS, `> query[${qid}].updated =`, $U.json(upds));
        }

        // FINAL. returns.
        return { queryId: qid, batchId: bid, queueId, started: updated.started, $batch };
    };

    /**
     * start batch with search-query.
     *
     * ```sh
     * $ http POST :8800/search/1000001/run-batch-next?count=1
     */
    public postSearchRunBatchNext: NextHandler = async (id, param, body, $ctx) => {
        _log(NS, `postSearchRunBatchNext(${id})..`);
        param && _log(NS, `> param = `, $U.json(param));
        body && _log(NS, `> body = `, $U.json(body));
        const batchId = id == '0' ? '' : id;
        //! WARN - must be matched with the current batch run-count
        const count = $T.N(param?.count, 0);
        const _limit = $T.N(param?.limit, param?.limit === '' ? count + 1 : 0); // limit 설정있으면, 1번만 자동 실행토록..
        const $batch: SearchBatchModel = await this.search.$batch.getModelById(batchId).catch(NUL404);
        const hl = (a: any) => `\`${typeof a === 'number' ? a : a || ''}\``;

        const name = $batch.name && $batch.name != '#' ? $batch.name : $batch.id;
        const slack = $T.B($batch.slack);

        //! run only if the count is matched!
        const limit = _limit || $U.N($batch.limit, 0); //! override `.limit` with param.
        if ($batch && $batch.count === count) {
            const size = $U.N($batch.size, 0);
            const updates: SearchBatchModel = {};
            _log(NS, `> count,limit,size,started =`, [count, limit, size, $batch.started]);
            // STEP.2 run each batch
            let hasFinished = false;
            const t0 = performance.now(); // start of processing
            if (!$batch.started) {
                hasFinished = true;
                updates.state = 'stopped';
            } else if (limit >= 0 && count >= limit) {
                hasFinished = true;
                updates.state = 'finished';
            } else {
                const { query, last } = JSON.parse($batch.batch);
                if (!query) throw new Error(`@batch[${batchId}].query is required!`);

                //! prepare search-body and run query.
                const srch: SearchBody = query;
                if (last) srch.search_after = last;
                //NOTE - 가끔 ES검색이 실패할 경우가 있으며, 재시도가 필요함!
                _inf(NS, `> search =`, $U.json(srch));
                const $res = await this.runQuery(srch, size).catch(e =>
                    doReportError(e, $ctx, null, { id, param, body, $batch }).then<SearchResult<unknown>>(() => {
                        hasFinished = true;
                        //INFO - `TooManyRequest`와 같은 에러로 멈출수 있음...
                        updates.state = 'failed';
                        updates.error = `runQuery - ${GETERR(e)}`;
                        //TODO - determine to retry........
                        return { total: 0, last, list: [] };
                    }),
                );
                _inf(NS, `> $res =`, $U.json({ ...$res, list: undefined }));

                //! run the target batch-handler.
                const target = $batch.target;
                const params: BatchParams = {
                    meta: this.search.$batch.asMeta$($batch.meta),
                    index: count,
                    context: $ctx,
                };
                const list = await this.search.runBatchHandler(target, $res?.list, params).catch(e => {
                    _err(NS, `! err =`, e);
                    //INFO - 핸들러함수에서 에러를 발생할 수 있으며, 이때 멈춰야함.
                    hasFinished = true;
                    updates.state = 'failed';
                    updates.error = `runBatchHandler - ${GETERR(e)}`;
                    return null as any[];
                });

                // report results as body.
                const list2 = list?.map((N: any) =>
                    N && N instanceof Error ? { error: GETERR(N) } : { id: N.id, error: N.error },
                );
                body = {
                    total: $res?.total,
                    size: size,
                    last: $res?.last,
                    list: list2,
                    count: $U.N(list2?.length, 0),
                    error: $U.N(list2?.filter(N => !!N.error).length, 0),
                };
                //! check if finished (no list, or last is empty).
                if (hasFinished) {
                    updates.state = updates.state || 'stopped';
                } else if (limit >= 0 && count >= limit - 1) {
                    hasFinished = true;
                    updates.state = 'finished';
                } else if (!list?.length || !$res?.last) {
                    hasFinished = true;
                    updates.state = 'finished';
                } else {
                    updates.state = 'running';
                }

                //! prepare updates.
                updates.batch = $U.json({ query, last: $res.last });
            }

            // STEP.3 update batch.
            const updated = await this.search.$batch.storage.update(batchId, updates, { count: 1 });
            _inf(NS, `> updated =`, $U.json(updated));
            Object.assign($batch, { ...updated, id: batchId });
            const t1 = performance.now(); // start of processing
            const took = Math.round((t1 - t0) / 100) / 10; // in sec.

            // FINAL. check if finished.
            const opts = updates.error ? ` err:${hl(updates.error)}` : body?.error ? ` E:${hl(body?.error)}` : '';
            // eslint-disable-next-line prettier/prettier
            const title = `#batch[${hl(name)}] has ${hl($batch.state)} at ${hl(count)}/${hl(body?.total)}${opts} in ${hl(took)}s.`;
            const idx = $U.N(count, 0);
            const qid = hasFinished ? '' : await this.search.$batch.enqueueNext($batch, $ctx);
            if (idx % 10 === 0 || hasFinished || opts) {
                slack && (await $slack(title, { $batch, param, body, $ctx, qid, limit }));
            }
        } else {
            // eslint-disable-next-line prettier/prettier
            slack && await $slack(`#batch[${hl(name)}] has ${hl('ignored')} at ${hl(count)}.`, { $batch, param, body, $ctx });
        }
    };

    /**
     * POST /search/0/migrate
     * - migrate the search index.
     *
     * ```sh
     * $ http POST ':8800/search/0/migrate'
     * $ http POST ':8800/search/0/migrate?limit=10'
     */
    public doPostMigrate: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doPostMigrate(${this.type()}/${id ?? ''})`;
        id = id == '0' ? '' : $T.S2(id);

        const isLocal = $ctx?.domain === 'localhost';
        if (!isLocal) throw new Error(`403 NOT ALLOWED - domain[${$ctx?.domain ?? ''}] is invali  @${errScope}`);
        if (id) throw new Error(`@id[${id}] is invalid - ${errScope}`);

        const $OS2 = _OS2();
        _inf(NS, `> option =`, $U.json($OS2.options));
        // const $res = await $OS2.describeIndex().catch(e => {
        //     _err(NS, `! err =`, e);
        //     return GETERR(e);
        // });
        const opts = { stopOnError: true, limit: $T.N(param?.limit, 5) };
        const $res = await $OS2.synchronizeContents(opts).catch(e => {
            _err(NS, `! err =`, e);
            return GETERR(e);
        });

        return $res;
    };
}

//! export as default.
export default new SearchAPIController();
