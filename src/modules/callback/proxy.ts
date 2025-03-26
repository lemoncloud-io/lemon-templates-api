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
import { $U, _inf, _log, _err } from 'lemon-core';
import { $T, MyCoreProxy, MyManagerProxy } from '../../cores';
import { CallbackHead, CallbackModel, ModelType } from './model';
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
}
