/**
 * `service.ts`
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
import { $U, _inf, _log, _err, CoreModel } from 'lemon-core';
import { $T, MyCoreManager, MyCoreService } from '../../cores';
import { $FIELD, ConnectionModel, ModelType, SocketModel } from './model';
import { BackendProxy } from './proxy';
const NS = $U.NS('socket', 'blue'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendService` */
export interface BackendService<T extends ModelType = any> extends MyCoreService<CoreModel<T>, T, BackendProxy> {
    readonly $socket: SocketModelManager;
    readonly $connection: ConnectionModelManager;

    /** say hello() */
    hello(): string;
}

/**
 * class: `SocketModelManager`
 * - manager for socket-model.
 */
export class SocketModelManager extends MyCoreManager<SocketModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('socket', parent, $FIELD.socket);
    }

    /**
     * @override validate
     */
    public async validateModel(model: SocketModel, $org?: SocketModel) {
        const errScope = `validate(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        return model;
    }
}

/**
 * class: `ConnectionModelManager`
 * - manager for Connection-model.
 */
export class ConnectionModelManager extends MyCoreManager<ConnectionModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('connection', parent, $FIELD.connection);
    }

    /**
     * @override validate
     */
    public async validateModel(model: ConnectionModel, $org?: ConnectionModel) {
        const errScope = `validate(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        return model;
    }
}
