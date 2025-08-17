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
import { $U, _log, _inf, _err, GETERR, NextContext, $slack, my_parrallel, doReportError } from 'lemon-core';
import { WSSEvent, LambdaHandlerService, WSSHandler } from 'lemon-core';
import { $T, onlyDefined } from '../../cores';
import { failure, notfound, success } from 'lemon-core/dist/cores/lambda/lambda-wss-handler';
import { convertWSSEvent, buildSocketResponse, parseMessage } from './tools';
import { ConnectionInfo, SocketActionType, SocketEvent, SocketEventType } from './wss-types';
export { SocketPayload, SocketResponse } from './wss-types';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BackendService } from '../../service/backend-service';
const NS = $U.NS(`wss`, 'green'); // NAMESPACE TO BE PRINTED.

/**
 * type: `WSSAgentRunner`
 * - interface for running WebSocket events.
 */
export interface WSSAgentRunner {
    /**
     * Handle incoming WebSocket events.
     * @param event SocketEvent
     * @param context NextContext
     */
    onSocketEvent(event: SocketEvent, context: NextContext): Promise<any>;
}

/**
 * class: `LambdaWSSHandler`
 * - the lambda handler for WSS events.
 * @implements @lemon-core/LambdaHandlerService<WSSHandler>
 */
export class LambdaWSSHandler implements LambdaHandlerService<WSSHandler> {
    public constructor(readonly service: BackendService, readonly runner: WSSAgentRunner) {
        if (!service) throw new Error(`@service is required - LambdaWSSHandler`);
        if (!runner) throw new Error(`@runner is required - LambdaWSSHandler`);
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

        //* decode event and notify into slack.
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

        //* handle the event..
        try {
            const $evt = convertWSSEvent(event);
            const $res = await this.runner.onSocketEvent($evt, context);
            if (typeof $res !== undefined) return success($res);
        } catch (e) {
            const err = GETERR(e);
            if (err.startsWith('404 ')) return notfound(err);
            await doReportError(e, context, event);
            return failure(err);
        }
    };

    /**
     * send message to client.
     */
    public async doSend(endpoint: string, connectionId: string, payload?: object | string) {
        const errScope = `doSend(${endpoint ?? ''}/${connectionId ?? ''})`;
        const region = $U.env('DEFAULT_REGION', 'ap-northeast-2');
        const $client = new ApiGatewayManagementApiClient({ region, endpoint });
        const command = new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: typeof payload !== 'string' ? JSON.stringify(payload) : payload,
        });
        // _inf(NS, `> command =`, $U.json(command));

        // ignore internal error
        try {
            const $res = await $client.send(command);
            //TODO [Steve] `Forbidden` occured in ssocio/VPC configuration @250808
            //NOTE - 다만 lemon에서는 잘 작동하는듯함. (VPC 구성 없음!)
            // $res := {"$metadata":{"httpStatusCode":200,"requestId":"b86aec0a-85aa-4ab3-bbf4-30c52c808970","attempts":1,"totalRetryDelay":0}}
            _log(NS, `> $res@${errScope} =`, $U.json($res));
            return $res;
        } catch (e) {
            _err(NS, `> error@${errScope} =`, GETERR(e), e);
            throw e;
        }
    }
}

/**
 * builder/factory for sockets per each event.
 *
 * @deprecated use `WSSAgentRunner` instead.
 */
export const $sockets = (service: BackendService, event?: WSSEvent, context?: NextContext) => {
    const $evt = convertWSSEvent(event);
    return new WSSAgent(service, $evt, context);
};

/**
 * class: `WSSAgent`
 * - support class for WebSocket events.
 *
 * @deprecated use `WSSAgentRunner` instead.
 */
export class WSSAgent {
    /**
     * default constructor
     */
    public constructor(readonly service: BackendService, readonly event: SocketEvent, readonly context: NextContext) {
        _log(NS, `WSSAgent(${event?.type || ''}/${event?.connectionId || ''})...`);
    }

    /** say hello */
    public hello = () => `wss:${this.event?.type || ''}:${this.event?.connectionId || ''}`;

    /**
     * run and return response.
     */
    public $run = async (): Promise<void> => {
        const event = this.event;
        const errScope = `$run(${event?.direction ?? '-'}/${event?.id ?? ''})`;
        if (!event || !event.id) throw new Error(`@event is required - ${errScope}`);
        const _run = async (type: SocketEventType) => {
            if (!type) {
                throw new Error(`@type (string) is required - ${errScope}`);
            } else if (type == 'CONNECT') {
                return this.onConnect(event);
            } else if (type == 'DISCONNECT') {
                return this.onDisconnect(event);
            } else if (type == 'MESSAGE') {
                return this.onMessage(event);
            } else {
                throw new Error(`@type[${type}] is invalid! - ${errScope}`);
            }
        };
        //* return must be void (200);
        await _run(event?.type);
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

        //* run in guard-proxy
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

        //* run in guard-proxy
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
        const action = $msg.action as SocketActionType;
        _inf(NS, `> action @${errScope} =`, action);

        // STEP.1 route to handler
        switch (action) {
            case 'echo':
                const $echo = buildSocketResponse('echo', onlyDefined({ param, body, connectionId }));
                await this.postClientMessage($echo, event);
                return $echo;
            case 'ping':
                const $pong = buildSocketResponse('pong', $msg?.data);
                await this.postClientMessage($pong, event);
                return $pong;
            default:
                const message = `@action[${action}] is invalid (not supported) - ${errScope}`;
                throw new Error(message);
        }
    }

    /**
     * post to client
     * @param payload   object or string
     * @param $conn     connection-info
     */
    public postClientMessage = async (payload: any, $conn?: ConnectionInfo) => {
        $conn = $conn || this.event;
        const { stage, domain, connectionId } = $conn;
        if (!domain) throw new Error(`@domain (string) is required!`);
        const url = `https://${domain}/${stage || ''}`;
        return this.doSend(url, connectionId, payload);
    };

    /**
     * send message to client.
     */
    public async doSend(endpoint: string, connectionId: string, payload?: any) {
        const errScope = `doSend(${endpoint ?? ''}/${connectionId ?? ''})`;
        const region = $U.env('DEFAULT_REGION', 'ap-northeast-2');
        const $client = new ApiGatewayManagementApiClient({ region, endpoint });
        const command = new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: payload && typeof payload === 'object' ? JSON.stringify(payload) : `${payload ?? ''}`,
        });
        _inf(NS, `> command =`, $U.json(command));

        // ignore internal error
        try {
            const $res = await $client.send(command);
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
     * broadcast message to all nodes in the channel/stereo.
     *
     * @param channel
     * @param stereo
     * @param data
     * @param type
     * @returns
     */
    public async broadcast(channel: string, stereo: string, data?: any) {
        const errScope = `broadcast(${channel ?? ''}/${stereo ?? ''})`;
        _log(NS, `${errScope}...`);

        // STEP.1 prepare messasge to be sent
        return this.service.guardProxy(this.context, async proxy => {
            const { $channel } = await proxy.establishChannel(channel, stereo);
            _log(NS, `> $channel[${$channel?.id}] =`, $U.json($channel));

            const { list: $conns } = await proxy.connection.listAvailableConns($channel.id, { useSearch: false });
            if (!$conns || !$conns?.length) return 0;

            const $sent = await my_parrallel($conns, async N => {
                const connId = N?.id ? $T.S2(N.id) : null;
                const $conn = connId ? await proxy.connection.get(connId) : null;
                //* if valid, post msg...
                if ($conn?.connected && $conn?.connectionId) {
                    return this.postClientMessage(data, $conn)
                        .then(() => {
                            return { id: N.id, error: null as string };
                        })
                        .catch(e => {
                            const error = e instanceof Error ? GETERR(e) : e;
                            if (error?.message === '410') return { id: N.id }; //* ignore if `GoneException`
                            _err(NS, `>> conn[${connId}].err =`, $U.json(error));
                            return { error: e, id: N.id, $conn };
                        });
                }
                return null;
            });

            const errors = $sent.filter(N => N && N.error);
            return { $conns, $sent, count: $sent.length, errors };
        });
    }
}
