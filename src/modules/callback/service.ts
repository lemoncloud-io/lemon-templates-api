/**
 * `service.ts`
 * - proxy of backend managers
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _inf, _log, _err, CoreModel, Body, $slack } from 'lemon-core';
import { $FIELD, CallbackModel, CallbackRequest, ModelType } from './model';
import { MyCoreManager, MyCoreService } from 'lemon-core';
import { SearchService } from '../search/service';
import { BackendProxy } from './proxy';
const NS = $U.NS('callback', 'blue'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendService` */
export interface BackendService<T extends ModelType = any> extends MyCoreService<CoreModel<T>, T, BackendProxy> {
    readonly $callback: CallbackModelManager;

    // search-service.
    readonly search: SearchService;

    /** say hello() */
    hello(): string;
}

/**
 * callback handler.
 */
export interface CallbackHandler<Res extends Body = Body, Req = CallbackRequest> {
    /** process to handle the response via callback */
    (proxy: BackendProxy, $res: Res, $req: Req, $cb?: CallbackModel): Promise<string>;
}

/**
 * class: `CallbackModelManager`
 * - manager for callback-model.
 */
export class CallbackModelManager extends MyCoreManager<CallbackModel, ModelType, BackendService> {
    /** handler map */
    public readonly _callback: Map<string, CallbackHandler> = new Map();

    /** default contructor */
    public constructor(parent: BackendService) {
        super('callback', parent, $FIELD.callback, { enableSync: true }); //* v5 B5: sync is opt-in (lemon-core default false).

        /** report into slack */
        this.registerCallback('echo', async (proxy, $res, $req, model) => {
            _inf(NS, `! result =`, $U.json($res));
            const id = model?.id;
            const param = $req?.param;
            const body = $req?.body;
            const $ctx = proxy.context;
            await $slack(`#callback/\`${id ?? ''}\` echo`, { param, body, $ctx, $res });
            return 'echo/done';
        });
    }

    /** check if has callback handler */
    public hasCallback(name: string) {
        return this._callback.has(name);
    }

    /** process the calblack */
    public async doCallback(name: string, proxy: BackendProxy, $res: Body, model?: CallbackModel) {
        const errScope = `doCallback(${this.type}/${model?.id ?? ''})`;
        const handler = this._callback.get(name);
        if (typeof handler !== 'function') throw new Error(`@name[${name}] not registered - ${errScope}`);
        const $req = model?.$request;
        const result = await handler(proxy, $res, $req, model);
        if (result && typeof result !== 'string') throw new Error(`@result[${result}] is invalid - ${errScope}`);
        return result;
    }

    /** register callback handler */
    public registerCallback(name: string, handler: CallbackHandler, options?: { force?: boolean }) {
        const errScope = `registerHandler(${this.type}/${name ?? ''})`;
        const force = options?.force ?? false;
        if (!handler) throw new Error(`@handler(function) is required - ${errScope}`);
        if (!force && this._callback.has(name)) throw new Error(`@name[${name}] already registered - ${errScope}`);
        this._callback.set(name, handler);
    }

    /**
     * @override validate
     */
    public async validateModel(model: CallbackModel, $org?: CallbackModel) {
        const errScope = `validateModel(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        if (isCreate && model?.name == '#') throw Error(`.name[${model?.name}] is invalid - ${errScope}`);
        return model;
    }
}
