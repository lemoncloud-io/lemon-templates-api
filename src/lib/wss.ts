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
import { GETERR, LambdaHandlerService, WSSHandler } from 'lemon-core';
import { NextContext } from 'lemon-model';
import { SocketEvent } from './wss-types';
import { BackendService } from '../service/backend-service';
import { convertWSSEvent } from './tools';
import { $U, WSSEvent, _log } from 'lemon-core';
import { failure, notfound, success } from 'lemon-core/dist/cores/lambda/lambda-wss-handler';
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
     */
    public handle: WSSHandler = async (event, context) => {
        _log(NS, `handle()...`);
        const $req = event && event.requestContext;
        const EVENT_TYPE = ($req && $req.eventType) || '';
        const ROUTE_KEY = ($req && $req.routeKey) || '';
        _log(NS, '> context =', $U.json(context));
        _log(NS, `> event(${ROUTE_KEY}/${EVENT_TYPE}) =`, $U.json(event));
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
    protected service: BackendService;
    protected event: SocketEvent;
    protected context: NextContext;

    /**
     * default constructor
     */
    public constructor(service: BackendService, event: SocketEvent, context: NextContext) {
        this.service = service;
        this.event = event;
        this.context = context;
    }

    /** say hello */
    public hello = () => `wss:${this.event?.type || ''}:${this.event?.connectionId || ''}`;

    /**
     * run and return response.
     */
    public $run = async (): Promise<any> => {
        const errScope = `$run()`;
        const event = this.event;
        if (!event || !event.id) throw new Error(`@event is required - ${errScope}`);
        const { type } = event;
        if (!type) {
            throw new Error(`@type (string) is required - ${errScope}`);
        } else if (type == 'CONNECT') {
            return this.doConnect(event);
        } else if (type == 'DISCONNECT') {
            return this.doDisconnect(event);
        } else {
            throw new Error(`@type[${type}] is invalid! - ${errScope}`);
        }
    };

    /**
     * handle for connection event.
     */
    public async doConnect(event?: SocketEvent): Promise<any> {
        const errScope = `doConnect(${event?.id ?? ''})`;
        event = event || this.event;
        return { hello: this.hello(), event };
    }

    /**
     * handle for disconnection event.
     */
    public async doDisconnect(event?: SocketEvent): Promise<any> {
        const errScope = `doConnect(${event?.id ?? ''})`;
        event = event || this.event;
        return { hello: this.hello(), event };
    }
}
