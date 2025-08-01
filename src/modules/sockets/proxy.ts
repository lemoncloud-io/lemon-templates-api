/**
 * `proxy.ts`
 * - proxy of backend managers
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @author      Aiden <aiden@lemocloud.io>
 * @date        2025-07-23 refactored for sockets service
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, $T, _inf, _log, _err } from 'lemon-core';
import { MyCoreProxy, MyManagerProxy } from '../../cores';
import { ModelType, SocketModel } from './model';
import { BackendService, SocketModelManager } from './service';
import { $trans, SocketTransformer } from './transformer';
const NS = $U.NS('sockets', 'blue'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendProxy` */
export abstract class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    readonly socket: SocketManagerProxy;

    // backend-service.
    readonly service: BackendService;
}

/**
 * type: `SocketManagerProxy`
 * - the manager-proxy for socket-model
 */
export class SocketManagerProxy extends MyManagerProxy<SocketModel, SocketModelManager, BackendService> {
    /** default construction */
    public constructor(readonly proxy: BackendProxy, manager: SocketModelManager) {
        super(proxy, manager);
    }

    /** get the transformer */
    public get trans(): SocketTransformer {
        return $trans.socket;
    }

    /**
     * validate before creating or updating.
     */
    public async validateModel<T extends SocketModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const isCreate = !$org;
        const validated = await this.$mgr.validateModel(model, $org);

        //* test case for api calling.
        const errScope = `validate(${this.$mgr.type}/${modelId ?? ''})`;
        if (validated?.name == '#') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);
        if (isCreate && validated?.name == '!') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);

        // returns.
        return validated as T;
    }
}
