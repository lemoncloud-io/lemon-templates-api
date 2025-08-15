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
import { $T, AbstractCRUDController } from '../../cores';
import { SocketModel } from './model';
import { SocketModelManager } from './service';
import { $trans, SocketTransformer } from './transformer';
import { SocketBody, SocketView } from './views';
//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
import { $sockets, LambdaWSSHandler } from '../../lib/wss';
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

    /**
     * broadcast `body` to all connections in `id`
     *
     * ```sh
     * $ echo '{"hello":"world"}' | http ':8832/sockets/lemon.none/broadcast'
     * $ echo '{"id":"O100001"}' | http ':8832/sockets/ssocio-orders-api.orders/broadcast'
     * ```
     * @param id    channel-id like `lemon-sandbox-api.hello`
     */
    public doPostBroadcast: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doPostBroadcast(${id ?? ''})`;
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        id = id === '0' ? '' : $T.S2(id).trim();
        const [channel, stereo] = `${id || ''}`.split('.');

        // STEP.0 validate parameters.
        if (!channel) throw new Error(`@channel (string) is required - ${errScope}`);
        if (!stereo) throw new Error(`@stereo (string) is required - ${errScope}`);
        const $result = await $sockets(this.service, null, $ctx).broadcast(channel, stereo, body);
        return $result;
    };
}

// default export
export default new SocketAPIController($service, true);
