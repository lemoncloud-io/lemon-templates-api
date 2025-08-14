/**
 * `wss.ts`
 * - main library for sockets
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2020-06-30 initial version
 * @author      Aiden <aiden@lemoncloud.io>
 * @date        2025-07-31 refactored for WebSocket support
 *
 * @copyright   (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-cluster-api/cluster`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err, GETERR, NextContext, $slack } from 'lemon-core';
import { WSSEvent, LambdaHandlerService, WSSHandler } from 'lemon-core';
import { failure, notfound, success } from 'lemon-core/dist/cores/lambda/lambda-wss-handler';
import { SocketActionType, SocketEvent } from './wss-types';
import { convertWSSEvent, buildSocketResponse, parseMessage, parseBase64 } from './tools';
export { SocketPayload, SocketResponse } from './wss-types';
import { BackendService } from '../service/backend-service';
import { $T, onlyDefined } from '../cores';
import {
    ApiGatewayManagementApiClient,
    DeleteConnectionCommand,
    PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
const NS = $U.NS(`wss`, 'green'); // NAMESPACE TO BE PRINTED.

/**
 * class: `LambdaWSSHandler`
 * - the lambda handler for WSS events.
 * @implements @lemon-core/LambdaHandlerService<WSSHandler>
 */
export class LambdaWSSHandler implements LambdaHandlerService<WSSHandler> {
    readonly service: BackendService;
    public constructor(service: BackendService) {
        this.service = service;
    }

    /**
     * Default WSS Handler.
     *
     * 1. send message like { action: 'echo', data: 'world'}
     * - `routeKey` will be `echo`. (see serverless.yml)
     * 2. send message like { action: 'hello', data: 'world'}
     * - `routeKey` will be `$default`. (see serverless.yml)
     */
    public handle: WSSHandler = async (event, context) => {
        _log(NS, `handle()...`);
        const $req = event?.requestContext;
        const ROUTE = [$req?.eventType ?? '', $req?.routeKey ?? ''].join('/');
        _log(NS, `> context(${ROUTE}) =`, $U.json(context));
        _log(NS, `> event(${ROUTE}) =`, $U.json(event));
        const _slack = async () => {
            const $msg = parseMessage(event.body);
            const action = $msg?.action as SocketActionType;
            const title = !action ? `#socket/${ROUTE}` : `#socket/${ROUTE}/${action}`;
            await $slack(title, { context, event }, null, { context });
        };
        await _slack().catch(e => _err(NS, `! error@slack =`, GETERR(e), e));

        //TODO - define the exact type of result(WSResult).
        return $sockets(this.service, event, context)
            .$run()
            .then(r => success(r || ''))
            .catch(e => {
                const err = GETERR(e);
                if (err.startsWith('404 ')) return notfound(err);
                return failure(err);
            });
    };
}

/**
 * builder/factory for sockets per each event.
 */
export const $sockets = (service: BackendService, event?: WSSEvent, context?: NextContext) => {
    const $evt = convertWSSEvent(event);
    return new WSSAgent(service, $evt, context);
};

/**
 * class: `WSSAgent`
 * - support class for WebSocket events.
 */
export class WSSAgent {
    private readonly $client: ApiGatewayManagementApiClient;

    /**
     * default constructor
     */
    public constructor(readonly service: BackendService, readonly event: SocketEvent, readonly context: NextContext) {
        _log(NS, `WSSAgent(${event?.type || ''}/${event?.connectionId || ''})...`);
        const { stage, domain } = event;
        const endpoint = `https://${domain}/${stage}`;
        const region = $U.env('DEFAULT_REGION', 'ap-northeast-2');
        _inf(NS, `> $config =`, $U.json({ region, endpoint }));
        this.$client = new ApiGatewayManagementApiClient({ region, endpoint });
    }

    /** say hello */
    public hello = () => `wss:${this.event?.type || ''}:${this.event?.connectionId || ''}`;

    /**
     * run and return response.
     */
    public $run = async (): Promise<any> => {
        const event = this.event;
        const errScope = `$run(${event?.direction ?? '-'}/${event?.id ?? ''})`;
        if (!event || !event.id) throw new Error(`@event is required - ${errScope}`);
        const type = event?.type;
        if (!type) {
            throw new Error(`@type (string) is required - ${errScope}`);
        } else if (type == 'CONNECT') {
            return this.onConnect(event).then(() => null);
        } else if (type == 'DISCONNECT') {
            return this.onDisconnect(event).then(() => null);
        } else if (type == 'MESSAGE') {
            return this.onMessage(event).then(() => null); //! return must be void (200);
        } else {
            throw new Error(`@type[${type}] is invalid! - ${errScope}`);
        }
    };

    /**
     * handle for connection event.
     */
    public async onConnect(event?: SocketEvent): Promise<any> {
        const errScope = `doConnect(${event?.id ?? ''})`;
        event = event ?? this.event;

        // STEP.0 extract parameters
        const { param } = event;
        const channel = $T.S2(param?.channel, 'lemon');
        const stereo = $T.S2(param?.stereo, 'none');
        _log(NS, `> ${channel}:${stereo}@${errScope}`);

        //! run in guard-proxy
        return this.service.guardProxy(this.context, async proxy => {
            // STEP.1 find or create channel model
            const { $channel } = await proxy.establishChannel(channel, stereo);
            _log(NS, `> $channel[${$channel?.id}] = `, $U.json($channel));

            // STEP.2 find or create connection model
            const $conn = await proxy.connection.findModel(event);
            _log(NS, `> $conn[${$conn?.id}] = `, $U.json($conn));

            // STEP.3 update connection model with channel
            //TODO - 테스트를 위한 단일 채널 연결! @aiden
            const $res = await proxy.connection.updateConnection($conn, { channels: [$channel.id] });
            return {
                id: event?.id,
                $conn: $res,
                $channel,
            };
        });
    }

    /**
     * handle for disconnection event.
     * - 연결 해제 시 끊기는 이유와 끊긴 시각을 기록한다.
     */
    public async onDisconnect(event?: SocketEvent): Promise<any> {
        const errScope = `onDisconnect(${event?.id ?? ''})`;
        event = event ?? this.event;
        _log(NS, `${errScope}...`);

        //! run in guard-proxy
        return this.service.guardProxy(this.context, async proxy => {
            // STEP.1 update disconnection info
            // TODO - 리팩토링 예정 @aiden
            const $conn = await proxy.connection.updateDisconnection(event);

            return {
                id: event?.id,
                $conn,
            };
        });
    }

    /**
     * handle for message event.
     */
    public async onMessage(event?: SocketEvent): Promise<any> {
        const errScope = `onMessage(${event?.direction}/${event?.id ?? ''})`;
        event = event ?? this.event;
        const { body, param, connectionId } = event;

        // STEP.0 validate body, and parse payload
        const $msg = parseMessage(body);
        const connId = parseBase64(connectionId);
        const action = $msg.action as SocketActionType;
        _inf(NS, `> action @${errScope} =`, action);

        // STEP.1 route to handler
        switch (action) {
            case 'echo':
                const $echo = buildSocketResponse('echo', onlyDefined({ param, body, connectionId }));
                await this.doSend($echo, { event });
                return $echo;
            case 'ping':
                const $pong = buildSocketResponse('pong', $msg?.data);
                await this.doSend($pong, { event });
                return $pong;
            default:
                const message = `@action[${action}] is not supported - ${errScope}`;
                const $err = buildSocketResponse('error', { message, action });
                await this.doSend($pong, { event });
                return $err;
        }
    }

    /**
     * send message to client.
     */
    public async doSend(data?: any, options?: { event?: SocketEvent }) {
        const event = options?.event ?? this.event;
        const errScope = `doSend(${event?.direction}/${event?.id ?? ''})`;

        const { connectionId } = this.event;
        const connId = parseBase64(connectionId);
        const command = new PostToConnectionCommand({
            ConnectionId: 0 ? connId : connectionId,
            Data: data && typeof data === 'object' ? JSON.stringify(data) : `${data ?? ''}`,
        });
        _inf(NS, `> command =`, $U.json(command));

        // ignore internal error
        try {
            const $res = await this.$client.send(command);
            //TODO [Steve] `Forbidden` occured in ssocio/VPC configuration @250808
            //NOTE - 다만 lemon에서는 잘 작동하는듯함. (VPC 구성 없음!)
            // $res := {"$metadata":{"httpStatusCode":200,"requestId":"b86aec0a-85aa-4ab3-bbf4-30c52c808970","attempts":1,"totalRetryDelay":0}}
            _log(NS, `> $res@${errScope} =`, $U.json($res));
        } catch (e) {
            //TODO [Steve] need to report error @250808
            _err(NS, `> error@${errScope} =`, GETERR(e), e);
            throw e;
        }

        // returns -> any purpose ??
        return { connectionId };
    }

    /**
     * delete connection by id
     */
    private async disconnectClient(event: SocketEvent) {
        const errScope = `disconnectClient(${event?.direction}/${event?.id ?? ''}))`;
        _log(NS, `${errScope}...`);

        const { connectionId } = event;
        const connId = parseBase64(connectionId);
        const command = new DeleteConnectionCommand({ ConnectionId: 0 ? connId : connectionId });
        _inf(NS, `> command =`, $U.json(command));

        // ignore internal error
        try {
            const $res = await this.$client.send(command);
            _log(NS, `> $res@${errScope} =`, $U.json($res));
        } catch (e) {
            _err(NS, `> error@${errScope} =`, GETERR(e), e);
            throw e;
        }
    }
}
