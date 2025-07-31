/**
 * `api-sockets.ts`
 * - api controller for `/sockets`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @author      Aiden <aiden@lemoncloud.io>
 * @date        2025-07-31 refactored for sockets service
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err } from 'lemon-core';
import { AbstractCRUDController } from '../../cores';
import { SocketModel } from './model';
import { SocketModelManager } from './service';
import { $trans, SocketTransformer } from './transformer';
import { SocketBody, SocketView } from './views';
//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
const NS = $U.NS('sockets', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `SocketAPIController`
 */
export class SocketAPIController extends AbstractCRUDController<
    ModelType,
    SocketModel,
    SocketView,
    SocketBody,
    BackendService,
    SocketModelManager,
    SocketTransformer
> {
    /**
     * Modern constructor with WebSocket integration
     */
    public constructor(service: BackendService = $service) {
        super('sockets', service, service.$socket, $trans.socket);
    }
}

// default export
export default new SocketAPIController();
