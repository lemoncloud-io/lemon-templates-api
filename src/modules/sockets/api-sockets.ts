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
import $cores, { $U, _log, _inf, _err, NextHandler, NextContext, $protocol } from 'lemon-core';
import { $T, AbstractCRUDController } from '../../cores';
import { LambdaWSSHandler, WSSAgentRunner } from '../../libs/wss/wss-agent';
import { SocketActionType, SocketEvent, SocketEventType } from '../../libs/wss/wss-types';
import { buildSocketResponse, parseMessage } from '../../libs/wss/tools';
import { SocketModel } from './model';
import { SocketModelManager } from './service';
import { $trans, SocketTransformer } from './transformer';
import { SocketBody, SocketView } from './views';
//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
const NS = $U.NS('sockets', 'yellow'); // NAMESPACE TO BE PRINTED.

type SocketHandler<Result = any> = NextHandler<{ [name: string]: string }, Result, SocketEvent>;

/**
 * class: `SocketAPIController`
 */
export class SocketAPIController
    extends AbstractCRUDController<
        ModelType,
        SocketModel,
        SocketView,
        SocketBody,
        BackendService,
        SocketModelManager,
        SocketTransformer
    >
    implements WSSAgentRunner
{
    public readonly $wss: LambdaWSSHandler;
    /**
     * Modern constructor with WebSocket integration
     */
    public constructor(service: BackendService = $service, register?: boolean) {
        super('sockets', service, service.$socket, $trans.socket);
        this.$wss = new LambdaWSSHandler(this.service, this);
        //! register into wss handler
        register && $cores.cores.lambda.lambda.setHandler('wss', this.$wss);
    }

    /** say hello */
    public hello = () => `socket-api-controller:${this.type()}`;

    /**
     * Handle incoming WebSocket events.
     */
    public async onSocketEvent(event: SocketEvent, context: NextContext): Promise<any> {
        const errScope = `$run(${event?.direction ?? '-'}/${event?.id ?? ''})`;
        if (!event) throw new Error(`@event is required - ${errScope}`);
        if (!event?.id) throw new Error(`@event.id (string) is required - ${errScope}`);
        const _run = async (type: SocketEventType | string) => {
            if (!type) {
                throw new Error(`@type (string) is required - ${errScope}`);
            } else if (type == 'echo' || type == 'ECHO') {
                return this.doPostEcho(event.id, event.param, event, context);
            } else if (type == 'CONNECT') {
                return this.doPostConnect(event.id, event.param, event, context);
            } else if (type == 'DISCONNECT') {
                return this.doPostDisconnect(event.id, event.param, event, context);
            } else if (type == 'MESSAGE') {
                return this.doPostMessage(event.id, event.param, event, context);
            } else {
                throw new Error(`@type[${type}] is invalid! - ${errScope}`);
            }
        };
        //* return must be void (200);
        return _run(event?.type);
    }

    /**
     * post to client
     * @param payload   object or string
     * @param event     connection-info
     */
    public postClientMessage = async (
        payload: any,
        event: SocketEvent,
        options?: { conId?: string; context?: NextContext; domain?: string },
    ) => {
        const errScope = `postClientMessage(${this.type()})`;
        const conId = options?.conId || event?.connectionId;
        const context = options?.context;
        //TODO [Steve] use env whether to use protocol.
        if (conId) {
            const url = options?.domain
                ? `https://${options.domain}/${event?.stage ?? ''}`
                : `https://0z5quzjfdc.execute-api.ap-northeast-2.amazonaws.com/dev`;
            const param = { endpoint: url };
            const body = payload;
            return $protocol({ ...context }, `//eureka-executes-api/connections/${conId}/send`).execute(param, body);
        }
        const { stage, domain } = event;
        if (!domain) throw new Error(`@domain (string) is required -${errScope}`);
        const url = `https://${domain}/${stage ?? ''}`;
        return this.$wss.doSend(url, conId, payload);
    };

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

    public doPostEcho: SocketHandler<any> = async (id, param, event, $ctx) => {
        const errScope = `doPostEcho(${this.type()}/${id ?? ''})`;
        event && _log(NS, `> event =`, $U.json(event));
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        id = id === '0' ? '' : $T.S2(id).trim();
        return;
    };

    public doPostConnect: SocketHandler<any> = async (id, param, event, $ctx) => {
        const errScope = `doPostConnect(${this.type()}/${id ?? ''})`;
        event && _log(NS, `> event =`, $U.json(event));
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        id = id === '0' ? '' : $T.S2(id).trim();

        const throws = param?.throws !== undefined ? $T.S2(param?.throws) : undefined;
        if (throws) throw new Error(`${throws} - ${errScope}`);

        // must returns some.
        return '';
    };

    public doPostDisconnect: SocketHandler<any> = async (id, param, event, $ctx) => {
        const errScope = `doPostDisconnect(${this.type()}/${id ?? ''})`;
        event && _log(NS, `> event =`, $U.json(event));
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        id = id === '0' ? '' : $T.S2(id).trim();
        return;
    };

    /**
     *
     * ```
     * $ echo '{"body":{"action":"ping","data":"PcKSjdK_oE0CIpg="}}' | http :8832/sockets/0/message
     */
    public doPostMessage: SocketHandler<void> = async (id, param, event, $ctx) => {
        const errScope = `doPostMessage(${this.type()}/${id ?? ''})`;
        event && _log(NS, `> event =`, $U.json(event));
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        id = id === '0' ? '' : $T.S2(id).trim();

        // STEP.0 validate body, and parse payload
        const $msg = parseMessage(event?.body);
        _inf(NS, `> message @${errScope} =`, $U.json($msg));
        const action = $msg?.action as SocketActionType;
        _inf(NS, `> action @${errScope} =`, action);

        //* press `enter` and should get 404 error.
        if (!event?.body) throw new Error(`404 NOT FOUND - empty body @${errScope}`);

        // STEP.1 route to handler
        switch (action) {
            case 'ping':
                const $pong = buildSocketResponse('pong', $msg?.data);
                const conId = typeof $msg?.data === 'string' ? $msg.data : event.connectionId;
                await this.postClientMessage($pong, event, { conId, domain: event?.domain });
                //WARN - should return `200` status.
                //TODO [Steve] 각 status 에 따른 행동 패턴 정리하기!!
                return null;
            default:
                const message = `@action[${action}] is invalid (not supported) - ${errScope}`;
                throw new Error(message);
        }
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
        const errScope = `doPostBroadcast(${this.type()}/${id ?? ''})`;
        body && _log(NS, `> body =`, $U.json(body));
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        id = id === '0' ? '' : $T.S2(id).trim();
        const [channel, stereo] = `${id || ''}`.split('.');

        // STEP.0 validate parameters.
        if (!channel) throw new Error(`@channel (string) is required - ${errScope}`);
        if (!stereo) throw new Error(`@stereo (string) is required - ${errScope}`);
        // const $result = await $sockets(this.service, null, $ctx).broadcast(channel, stereo, body);
        // return $result;
    };
}

// default export
export default new SocketAPIController($service, true);
