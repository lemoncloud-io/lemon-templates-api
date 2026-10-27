/**
 * `api-callback.ts`
 * - api controller for `/callback`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err, NextHandler, SearchQuery, $protocol, $slack } from 'lemon-core';
import { $T, AbstractCRUDController, MyManagerProxy, onlyDefined } from 'lemon-core';
import { Model, CallbackModel, CallbackRequest } from './model';
import { CallbackModelManager } from './service';
import { $trans, CallbackTransformer } from './transformer';
import $LUT, { CallbackBody, CallbackView } from './views';

//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
const NS = $U.NS('callback', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `CallbackAPIController`.
 */
export class CallbackAPIController extends AbstractCRUDController<
    ModelType,
    CallbackModel,
    CallbackView,
    CallbackBody,
    BackendService,
    CallbackModelManager,
    CallbackTransformer
> {
    /**
     * public constructor
     */
    public constructor(service: BackendService = $service) {
        super('callback', service, service.$callback, $trans.callback);
        _log(NS, `CallbackAPIController()...`);
    }

    /**
     * name of this resource
     */
    public hello = () => `callback-api-controller:${this.type()}`;

    /**
     * GET /callback/0/hello
     *
     * ```sh
     * $ http ':8800/callback/0/hello'
     *
     * $ http ':8800/callback/0' name=hello-v stereo=
     * $ http ':8800/callback/0' name=hello-d stereo=notice hidden=0 depth=0 order=0
     * $ http ':8800/callback/0' name=2nd stereo= parent=1000001 order=0
     */
    public doGetHello: NextHandler = async (id, param, body, $ctx) => {
        _log(NS, `doGetHello(${this.type()}/${id})..`);
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        const hello = this.hello();

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            // returns default.
            return { id, hello, param, body, context: { clientIp: $ctx.clientIp } };
        });
    };

    /**
     *
     * ```sh
     * $ http ':8800/callback/1000003/detail'
     */
    public doGetDetail: NextHandler = async (id, param, body, $ctx) => {
        _log(NS, `doGetDetail(${this.type()}/${id})..`);
        $ctx && _log(NS, `> context =`, $U.json($ctx));

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            const model = await proxy.callback.findModel(id);
            if (!model) throw new Error(`@id[${id}] is invalid - doGetDetail(${this.type()}/${id})`);
            const $trans = proxy.callback.trans;
            return $trans?.modelAsView(model);
        });
    };

    /**
     * 콜백를 등록하는 API
     *
     * ```sh
     * $ http POST ':8800/callback/0' stereo= name=hello01
     * @override
     */
    public doPost: NextHandler<any, CallbackView, CallbackBody> = async (id, param, body, $ctx) => {
        const errScope = `doPost(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        // body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id);

        // STEP.0 validate parameter
        const isLocal = $U.isLocalMode(); //* v5 B5: custom `id` only in local mode, not from `$ctx.domain`.
        if (id && !isLocal) throw new Error(`@id (string) is invalid - ${errScope}`);
        if (typeof body !== 'object') throw new Error(`@body (object) is required - ${errScope}`);

        /** create in general pattern. */
        const _create = async <M extends Model, T extends MyManagerProxy<M, any, any>>(
            $prx: T,
            model: M,
            options?: { throwable?: boolean },
        ) => {
            const useSession = this.confUseSession;
            const $base0 = await $prx.proxy.makeModelBase({}, { useSession, ...options });
            const $valid = await $prx.validateModel(model, null);
            const $final = await $prx.onBeforeSave($valid, null);
            const $model = await $prx.makeModel({ ...$final, ...$base0 }, true); //WARN! validate finally due to internal id
            return $prx.onAfterSave($model, null);
        };

        //* runs in guarded proxy.
        return this.service.guardProxy($ctx, async (proxy): Promise<CallbackView> => {
            const $prx = proxy.callback;

            // STEP.1 (TODO) validate user, and transform to model.
            const $model = $prx.trans.bodyToModel(body, true);
            if (!$model) throw new Error(`@body (CallbackBody) is required - ${errScope}`);

            const $final = await _create($prx, $model);
            return this.modelAsView($final);
        });
    };

    /**
     * 콜백 요청을 시작함.
     * 1. 콜백 요청 시작
     * 2. 콜백 요청에 대한 응답을 받음.
     * 3. 콜백 핸들러에 요청 전달함.
     *
     * ```sh
     * # make callback-model
     * $ http POST ':8800/callback/0' stereo= name=hello01
     *
     * # make callback-request via hello-api
     * $ http POST ':8800/callback/echo/request?prod' service=lemon-hello-api type=hello id=echo 'body[name]=hello'
     */
    public doPostRequest: NextHandler = async (id, param, body: CallbackRequest, $ctx) => {
        const errScope = `doPostRequest(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id);

        // STEP.0 validate parameter
        const isLocal = $U.isLocalMode(); //* v5 B5: custom `id` only in local mode, not from `$ctx.domain`.
        const isProd = !!$T.BN(param?.prod, param?.prod === '' ? 1 : 0);
        const isSimul = !!$T.BN(param?.simul, param?.simul === '' ? 1 : 0);
        if (id && !isLocal) throw new Error(`@id[${id}] is invalid - ${errScope}`);
        if (typeof body !== 'object') throw new Error(`@body (object) is required - ${errScope}`);

        //* runs in guarded proxy.
        return this.service.guardProxy($ctx, async proxy => {
            const $model = await proxy.callback.doRequest(id, body, { isProd, isSimul });
            return this.modelAsView($model);
        });
    };

    /**
     * 콜백 요청에 대한 응답처리
     *
     * ```sh
     * $ http POST ':8800/callback/1000001/response' data=world
     */
    public doPostResponse: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doPostResponse(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id);

        // STEP.0 validate parameter
        const isLocal = $U.isLocalMode(); //* v5 B5: runtime local mode (unused below, kept for the commented check).
        // if (id && !isLocal) throw new Error(`@id (string) is invalid - ${errScope}`);
        // if (typeof body !== 'object') throw new Error(`@body (object) is required - ${errScope}`);

        return this.service.guardProxy($ctx, async proxy => {
            const model = await proxy.callback.findModel(id);
            const $final = await proxy.callback.doResponse(model, body);
            return this.modelAsView($final);
        });
    };

    /**
     * list callback from main
     *
     * ```sh
     * $ http ':8800/callback/0/list'
     * $ http ':8800/callback/0/list?stereo='
     */
    public doGetList: NextHandler = async (id, param, body, $ctx) => {
        _log(NS, `doGetList(${this.type()}/${id})..`);
        $ctx && _log(NS, `> context =`, $U.json($ctx));

        // STEP.0 validate parameters.
        const stereo = param?.stereo !== undefined ? $T.asLut(param?.stereo, $LUT.CallbackStereo, 'stereo') : undefined; // target stereo to filter.
        const hidden = $T.B(param?.hidden, param?.hidden === '' ? 1 : 1);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            const model = this.bodyToModel({ ...param, stereo }, true);
            const { $page, $param } = proxy.callback.packSearchParam(param, model, { limit: 100 });
            _log(this.logNS, `>> $page =`, $U.json($page));
            _log(this.logNS, `>> $param =`, $U.json($param));

            //* ------- using scan
            const _scan = async () => {
                // 1. build scan-filter w/ dynamo.
                const filter = this.manager.buildScanFilter($param);
                const $res = await this.manager.doScan($page, filter);
                return $res;
            };

            //* –------ using search
            const _search = async <T extends CallbackModel>() => {
                // 1. build search request body
                const body = this.manager.buildQuery($page, $param);
                body.sort = { order: { order: 'asc', missing: '_last' } };
                const $must: SearchQuery[] = [];
                if (hidden) {
                    $must.push({
                        bool: {
                            should: [
                                {
                                    bool: {
                                        must_not: {
                                            exists: {
                                                field: 'hidden',
                                            },
                                        },
                                    },
                                },
                                {
                                    range: {
                                        hidden: { lte: 0 },
                                    },
                                },
                            ],
                            minimum_should_match: 1,
                        },
                    });
                }
                body.query.bool.must = $must;
                // 2. search query.
                return proxy.service.search.search<T>(body);
            };

            const hasES = this.service.hasSearchEngine();
            const $res = hasES ? await _search() : await _scan();
            const list = $res?.list?.map(N => this.modelAsView(N));
            return { ...$page, list, total: $res?.total };
        });
    };
}

// default export
export default new CallbackAPIController();
