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
import { $U, _inf, _log, _err, $protocol, GETERR } from 'lemon-core';
import { $T, MyCoreProxy, MyManagerProxy, onlyDefined } from '../../cores';
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

        return validated as T;
    }

    /**
     * make request to target api.
     */
    public async doRequest(
        request: CallbackRequest,
        options?: {
            parent?: CallbackModel;
            isProd?: boolean;
            current?: number;
            isSimul?: boolean;
        },
    ): Promise<CallbackModel> {
        const errScope = `doRequest(${request?.service ?? '-'}/${request?.id ?? '-'})`;
        const parent = options?.parent ?? null;
        const isProd = options?.isProd;
        const isSimul = options?.isSimul;
        const current = options?.current ?? this.$mgr.storage.storage.getTime();

        // STEP.0 validate parameters.
        if (!request) throw new Error(`@request (object) is required - ${errScope}`);
        // if (!parent?.id) throw new Error(`@model.id (string) is required - ${errScope}`);

        // STEP.1 build target url.
        const _S2 = (name: string, required = true) => {
            const s = $T.S2((request as any)?.[name]);
            if (!s && required) throw new Error(`@request.${name} (string) is required - ${errScope}`);
            return s;
        };
        const [service, type, _id, cmd] = [_S2('service'), _S2('type'), _S2('id'), _S2('cmd', false)];
        const target = `//${service}/${type}/${_id}` + (cmd ? `/${cmd}` : '');

        // STEP.2 prepare model to track
        const _modelId = async (): Promise<{ id: string; no?: number }> => {
            if (!parent) {
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
            stereo: parent.stereo ?? '#',
            name: parent.name,
            parentId: parent ? parent?.id : undefined,
            parent$: parent ? this.trans.asHead(parent) : undefined,
            request$: request,
        });
        const $valid = await this.validateModel($model, null);
        const $final = await this.makeModel($valid, false);
        const $ups = onlyDefined<CallbackModel>({});
        try {
            if (isSimul) throw new Error(`! in simulate mode - ${errScope}`);
            const context = this.proxy.asNextContext(null, { domain: 'localhost' });
            const callback = `callback/${parent.id}/response`;
            const $prot = $protocol(context, target, { isProd });
            const qid = await $prot.enqueue(request.param, request.body, 'POST', callback, 5);
            $ups.qid = qid;
            $ups.requestedAt = current;
        } catch (e) {
            _err(NS, `! err =`, e);
            $ups.error = GETERR(e);
        }
        return this.set($final.id, $ups);
    }
}
