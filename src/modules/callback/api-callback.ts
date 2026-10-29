/**
 * `api-callback.ts`
 * - api controller for `/callback`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 * @date        2026-10-30 loop test: `POST /callback/<kind>/loop`, `POST /callback/<loopId>/loop-recv` (see `loop.ts`).
 * @date        2026-10-30 loop test: `notify` and `enqueue` kinds (protocol service over SNS/SQS).
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
import { LoopTransports, defaultTransports, loopLog, isLoopKind, isNestedTrigger } from './loop';
import { asLoopPayload, onLoopRecv, onLoopError, loopKindOf, LOOP_SUBJECT, RECV_CMD, PROTOCOL_OPTIONS } from './loop';

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
     * @param service    backend service
     * @param transports provider of the loop-test send side (default: lemon-core SNS/SQS services + `$protocol()`)
     */
    public constructor(
        service: BackendService = $service,
        protected readonly transports: () => LoopTransports = defaultTransports,
    ) {
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
     * loop test trigger (admin only): send one loop message by `sns`, `sqs`, `protocol`, `notify` or `enqueue`.
     * - refuses a nested trigger (re-entry through the protocol channel) with `400 INVALID LOOP`.
     * - `protocol` waits for the receiver (`doPostLoopRecv()`) and returns its result.
     * - `notify` (SNS) and `enqueue` (SQS) go through the protocol service to `doPostLoopRecv()` in `backend`.
     *   they never pass a callback (a callback would be one more call after the receiver).
     *
     * ```sh
     * $ npm run lambda:invoke -- --stage dev --internal --identity '{"roles":["admin"]}' --method POST --path /callback/sns/loop
     * $ http POST ':8800/callback/sqs/loop' note=hi     # local mode (LOCAL_MODE=1)
     * ```
     */
    public doPostLoop: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doPostLoop(${this.type()}/${id ?? ''})`;
        _log(NS, `${errScope}...`);
        return this.service.guardProxy($ctx, async proxy => {
            //* admin first, so a non-admin learns nothing more.
            if (!proxy.hasAdminRole()) throw new Error(`403 NOT ALLOWED - only for admin @${errScope}`);
            //* guard: never start a loop from inside a loop.
            if (isNestedTrigger($ctx, this.type(), `${id ?? ''}`)) throw new Error(`400 INVALID LOOP - nested trigger`);
            if (!isLoopKind(id)) throw new Error(`404 NOT FOUND - ${this.type()}/${id ?? ''}/loop`);
            const payload = asLoopPayload(id, body);
            const { loopId, sentAt } = payload;
            const $aws = this.transports();

            //* sns: '' → the default topic (env `MY_SNS_ENDPOINT`).
            if (id === 'sns') {
                const messageId = await $aws.sns.publish('', LOOP_SUBJECT, payload);
                loopLog.inf(`[LOOP] send kind=sns loop=${loopId} message=${messageId}`);
                return { kind: id, loopId, messageId, sentAt };
            }
            //* sqs: the default queue (env `MY_SQS_ENDPOINT`); attributes carry the subject and the loop id.
            if (id === 'sqs') {
                const attr = { Subject: LOOP_SUBJECT, loop: id, loopId };
                const messageId = await $aws.sqs.sendMessage(payload, attr);
                loopLog.inf(`[LOOP] send kind=sqs loop=${loopId} message=${messageId}`);
                return { kind: id, loopId, messageId, sentAt };
            }
            //* protocol kinds: a signed protocol call to `//self/callback/<loopId>/loop-recv`; the payload is the body.
            //* the context claims `admin` (like `proxy.ts`) and raises `depth`, which marks it as a protocol hop.
            const identity: any = $ctx?.identity;
            const roles: string[] = [...(identity?.roles ?? []).filter((r: string) => r !== 'admin'), 'admin'];
            const context: any = { ...$ctx, identity: { ...identity, roles }, depth: $U.N($ctx?.depth, 0) + 1 };
            const target = `//self/${this.type()}/${loopId}/${RECV_CMD}`;
            const $proto = $aws.protocol(context, target, PROTOCOL_OPTIONS);
            const noCallback: string = undefined; //* guard: never a callback (it would call once more).
            //* notify: SNS topic of this service (`x-protocol-service`) → `backend`.
            if (id === 'notify') {
                const messageId = await $proto.notify(null, payload, 'POST', noCallback);
                loopLog.inf(`[LOOP] send kind=notify loop=${loopId} message=${messageId || '-'}`);
                return { kind: id, loopId, messageId, sentAt };
            }
            //* enqueue: SQS queue of this service (`x-protocol-service`) → `backend`, no delay.
            if (id === 'enqueue') {
                const messageId = await $proto.enqueue(null, payload, 'POST', noCallback, 0);
                loopLog.inf(`[LOOP] send kind=enqueue loop=${loopId} message=${messageId || '-'}`);
                return { kind: id, loopId, messageId, sentAt };
            }
            //* protocol: synchronized call to this service's `lambda` function (`//self`), waits for the result.
            loopLog.inf(`[LOOP] send kind=protocol loop=${loopId} message=-`);
            const result = await $proto.execute(null, payload, 'POST');
            loopLog.inf(`[LOOP] done kind=protocol loop=${loopId} rtt=${Date.now() - sentAt}ms`);
            return { kind: id, loopId, sentAt, result };
        });
    };

    /**
     * loop test receiver of the protocol kinds (`protocol`, `notify`, `enqueue`): log one `[LOOP] recv` line and
     * return. it never sends anything.
     * - allowed via the protocol channel (`depth > 0`) or for an admin; a direct non-admin request gets 403.
     * - a bad message (loop, loop id, sent time, `hop !== 1`) logs `[LOOP] bad` and returns ''.
     * - via the protocol channel it never throws: any error logs `[LOOP] bad … reason=error` and returns ''
     *   (a throw on the SQS protocol path is a redelivery, on the SNS path an error report).
     *
     * ```sh
     * $ http POST ':8800/callback/<loopId>/loop-recv' loop=protocol sentAt:=1 hop:=1     # local mode
     * ```
     */
    public doPostLoopRecv: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doPostLoopRecv(${this.type()}/${id ?? ''})`;
        _log(NS, `${errScope}...`);
        const viaProtocol = $U.N($ctx?.depth, 0) > 0;
        try {
            return await this.service.guardProxy($ctx, async proxy => {
                if (!viaProtocol && !proxy.hasAdminRole()) {
                    throw new Error(`403 NOT ALLOWED - protocol or admin only @${errScope}`);
                }
                return onLoopRecv(`${id ?? ''}`, body);
            });
        } catch (e) {
            //* a direct call keeps its error (403 etc.); the protocol channel never gets one.
            if (!viaProtocol) throw e;
            return onLoopError(loopKindOf(body), e);
        }
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
