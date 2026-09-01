/**
 * `proxy.ts`
 * - proxy of backend managers
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _inf, _log, _err, $protocol, GETERR, doReportError } from 'lemon-core';
import { $T, MyCoreProxy, MyManagerProxy, onlyDefined } from 'lemon-core';
import { CallbackHead, CallbackModel, CallbackRequest, ModelType } from './model';
import { BackendService, CallbackModelManager } from './service';
import { $trans, CallbackTransformer } from './transformer';
const NS = $U.NS('callback', 'green'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendProxy` */
export abstract class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    readonly callback: CallbackManagerProxy;

    // backend-service.
    readonly service: BackendService;
}

/**
 * type: `CallbackManagerProxy`
 * - the manager-proxy for callback-model
 */
export class CallbackManagerProxy extends MyManagerProxy<CallbackModel, CallbackModelManager, BackendService> {
    /** basic construction */
    public constructor(readonly proxy: BackendProxy, manager: CallbackModelManager) {
        super(proxy, manager);
    }

    /** get transformer */
    public get trans(): CallbackTransformer {
        return $trans.callback;
    }

    /**
     * get the model by id.
     */
    public async findModel(id: string, defaultOrThrow?: boolean | CallbackModel): Promise<CallbackModel> {
        const model = await this.get(id, defaultOrThrow ?? true);
        if (!model) return model;
        const meta = model?.meta;
        if (typeof meta === 'string' && meta.startsWith('{') && meta.endsWith('}')) {
            try {
                const $request: CallbackRequest = JSON.parse(meta);
                return onlyDefined({ ...model, $request, meta: undefined });
            } catch (e) {
                _err(NS, `! err =`, e);
                model.error = GETERR(e);
            }
        } else if (typeof meta === 'object') {
            return onlyDefined({ ...model, $request: meta, meta: undefined });
        }
        return model;
    }

    /**
     * update the model-head if id has changed.
     *
     * @param $new the new model to update.
     * @param $org (optional) the original model
     * @returns the final model
     */
    // eslint-disable-next-line prettier/prettier
    public async updateHead<T extends { callbackId?: string; callback$?: CallbackHead }>($new: T, $org?: T): Promise<T> {
        const callbackId = $new?.callbackId ?? $org?.callbackId;
        if (callbackId !== $org?.callbackId) {
            const model = callbackId ? await this.get(callbackId, false) : null;
            $new.callbackId = $T.S(model?.id, '');
            $new.callback$ = model ? this.trans.asHead(model) : null;
            return $new;
        }
        return $new;
    }

    /**
     * validate before creating or updating.
     */
    public async validateModel<T extends CallbackModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const isCreate = !$org;
        const validated = await this.$mgr.validateModel(model, $org);

        //* test case for api calling.
        const errScope = `validate(${this.$mgr.type}/${modelId ?? ''})`;
        if (validated?.name == '#') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);
        if (isCreate && validated?.name == '!') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);

        //* serialize the `$request` to meta JSON string.
        if (validated?.$request !== undefined) {
            if (validated.$request) {
                validated.meta = $U.json(validated.$request);
            } else {
                validated.meta = '';
            }
        }

        return validated as T;
    }

    /**
     * make request to target api.
     *
     * **[Usage]**
     * 1. register handler.
     *  see `service.callback.registerCallback('some', fx)`
     * 2. call `doRequest('some', $request)`
     * 3. wait for response via callback handler.
     */
    public async doRequest(
        handler: string,
        request: CallbackRequest,
        options?: {
            parent?: CallbackModel;
            isProd?: boolean;
            current?: number;
            isSimul?: boolean;
        },
    ): Promise<CallbackModel> {
        const parent = options?.parent ?? null;
        const errScope = `doRequest(${handler ?? '-'})`;
        const isProd = options?.isProd ?? false;
        const isSimul = options?.isSimul;
        const current = options?.current ?? this.$mgr.storage.storage.getTime();

        // STEP.0 validate parameters.
        if (!handler) throw new Error(`@handler (string) is required - ${errScope}`);
        if (!request) throw new Error(`@request (object) is required - ${errScope}`);
        if (!this.$mgr.hasCallback(handler)) throw new Error(`@handler[${handler}] not registered - ${errScope}`);

        // STEP.1 build target url.
        const _S2 = (name: string, required = true) => {
            const s = $T.S2((request as any)?.[name]);
            if (!s && required) throw new Error(`@request.${name} (string) is required - ${errScope}`);
            return s;
        };
        const [service, type, _id, cmd] = [_S2('service'), _S2('type'), _S2('id'), _S2('cmd', false)];
        const path = `/${type}/${_id}` + (cmd ? `/${cmd}` : '');
        const target = `//${service}${path}`;

        // STEP.2 prepare model to track
        const _modelId = async (): Promise<{ id: string; no?: number }> => {
            if (!parent?.id) {
                const id = await this.nextId();
                return { id };
            }
            const { no } = await this.inc(parent?.id, { no: 1 });
            const id = [parent?.id, no].join(':');
            return { id, no };
        };
        const { id: modelId, no } = await _modelId();
        const $model = onlyDefined<CallbackModel>({
            id: modelId,
            no,
            target,
            stereo: parent?.stereo ?? '',
            name: parent?.name ?? `POST ${path}`,
            parentId: parent ? parent?.id : undefined,
            parent$: parent ? this.trans.asHead(parent) : undefined,
            $request: request,
            handler,
            domain: this.proxy.context?.domain,
            clientIp: this.proxy.context?.clientIp,
            userAgent: this.proxy.context?.userAgent,
        });
        const $valid = await this.validateModel($model, null);
        const $final = await this.makeModel($valid, false);
        const $ups = onlyDefined<CallbackModel>({});
        try {
            if (isSimul) throw new Error(`! in simulate mode(req) - ${errScope}`);
            const context = this.proxy.asNextContext(null, { domain: 'localhost' });
            const callback = `callback/${modelId}/response`;
            const $prot = $protocol(context, target, { isProd: isProd ? true : undefined });
            const qid = await $prot.enqueue(request.param, request.body, 'POST', callback, 5);
            $ups.qid = qid;
            $ups.requestedAt = current;
            $ups.state = 'requested';
        } catch (e) {
            _err(NS, `! err =`, e);
            $ups.error = GETERR(e);
        }
        return this.set($final.id, $ups);
    }

    /**
     * make request to target api.
     */
    public async doResponse(
        model: CallbackModel,
        body: any,
        options?: {
            current?: number;
            isSimul?: boolean;
        },
    ): Promise<CallbackModel> {
        const errScope = `doResponse(${model?.id ?? '-'})`;
        const isSimul = options?.isSimul;
        const current = options?.current ?? this.$mgr.storage.storage.getTime();
        if (!model?.id) throw new Error(`@model (object) is required - ${errScope}`);

        const handler = model.handler;
        if (!this.$mgr.hasCallback(handler)) throw new Error(`@handler[${handler}] not registered - ${errScope}`);

        // STEP.1 validate parameters.
        const $ups = onlyDefined<CallbackModel>({
            responsedAt: current,
            state: 'responsed',
            error: '',
        });
        try {
            if (isSimul) throw new Error(`! in simulate mode(res) - ${errScope}`);
            const result = await this.$mgr.doCallback(handler, this.proxy, body, model);
            $ups.result = result;
        } catch (e) {
            _err(NS, `! err =`, e);
            if (isSimul) {
                $ups.error = GETERR(e);
            } else {
                const $ctx = this.proxy.asNextContext();
                $ups.error = await doReportError(e, $ctx, null, { model, body }).then(() => GETERR(e));
            }
        }

        // STEP.3 update the model
        return this.set(model.id, $ups);
    }
}
