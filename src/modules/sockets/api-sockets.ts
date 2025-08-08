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
import $core, { $U, _log, _inf, _err, NextHandler } from 'lemon-core';
import { AbstractCRUDController } from '../../cores';
import { SocketModel } from './model';
import { SocketModelManager } from './service';
import { $trans, SocketTransformer } from './transformer';
import { SocketBody, SocketView } from './views';
//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
import { LambdaWSSHandler } from '../../lib/wss';
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
    public readonly $wss: LambdaWSSHandler;
    /**
     * Modern constructor with WebSocket integration
     */
    public constructor(service: BackendService = $service, register?: boolean) {
        super('sockets', service, service.$socket, $trans.socket);
        this.$wss = new LambdaWSSHandler(this.service);

        //TODO [Steve] use `decode()` to handle event in this controller from wss @250808.
        //! register into wss handler
        register && $core.cores.lambda.lambda.setHandler('wss', this.$wss);
    }

    /** say hello */
    public hello = () => `socket-api-controller:${this.type()}`;

    /**
     * GET /sockets/0/hello
     *
     * ```sh
     * $ http ':8832/sockets/0/hello'
     */
    public doGetHello: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doGetHello(${id})`;
        _log(NS, `${errScope}..`);
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        const hello = this.hello();

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            // returns default.
            return { id, hello, param, body, context: { clientIp: $ctx.clientIp } };
        });
    };
}

// default export
export default new SocketAPIController($service, true);
