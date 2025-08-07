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
import { onlyDefined } from '../cores';
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
        await $slack(`#socket/${ROUTE}`, { context, event }, null, { context });

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
    public $run = async (): Promise<any> => {
        const event = this.event;
        const errScope = `$run(${event?.direction ?? '-'}/${event?.id ?? ''})`;
        if (!event || !event.id) throw new Error(`@event is required - ${errScope}`);
        const type = event?.type;
        if (!type) {
            throw new Error(`@type (string) is required - ${errScope}`);
        } else if (type == 'CONNECT') {
            return this.doConnect(event);
        } else if (type == 'DISCONNECT') {
            return this.doDisconnect(event);
        } else if (type == 'MESSAGE') {
            return this.onMessage(event);
        } else {
            throw new Error(`@type[${type}] is invalid! - ${errScope}`);
        }
    };

    /**
     * handle for connection event.
     */
    public async doConnect(event?: SocketEvent): Promise<any> {
        const errScope = `doConnect(${event?.id ?? ''})`;
        event = event ?? this.event;
        _log(NS, `${errScope}...`);

        // TODO - run authorization
        // STEP.1 find or create connection
        const $prxy = this.service.createProxy(this.context);
        const $conn = await $prxy.connection.readOrCreate(event);

        //! returns
        return {
            id: event?.id,
            $conn,
        };
    }

    /**
     * handle for disconnection event.
     * - 연결 해제 시 끊기는 이유와 끊긴 시각을 기록한다.
     */
    public async doDisconnect(event?: SocketEvent): Promise<any> {
        const errScope = `doDisconnect(${event?.id ?? ''})`;
        event = event ?? this.event;
        _log(NS, `${errScope}...`);

        // STEP.
        const $prxy = this.service.createProxy(this.context);
        const $disc = await $prxy.connection.updateDisconnection(event);

        //! returns
        return {
            id: event?.id,
            $disc,
        };
    }

    /**
     * handle for message event.
     */
    public async onMessage(event?: SocketEvent): Promise<any> {
        const errScope = `onMessage(${event?.direction}/${event?.id ?? ''})`;
        event = event ?? this.event;
        const { body, connectionId } = event;

        // STEP.0 validate body, and parse payload
        const $msg = parseMessage(body);
        const connId = parseBase64(connectionId);
        const action = $msg.action as SocketActionType;

        // STEP.1 route to handler
        switch (action) {
            case 'echo':
                const $res = onlyDefined({ param: event?.param, body, connectionId });
                return buildSocketResponse('echo', $res);
            case 'ping':
                return buildSocketResponse('pong', { connectionId });
            default:
                const message = `@action[${action}] is not supported - ${errScope}`;
                return buildSocketResponse('error', { message, action });
        }
    }
}
