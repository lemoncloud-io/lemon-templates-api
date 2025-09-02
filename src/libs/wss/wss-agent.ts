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
import { $U, _log, _inf, _err, GETERR, NextContext, my_parrallel, doReportError } from 'lemon-core';
import { WSSEvent, LambdaHandlerService, WSSHandler, $slack, $info } from 'lemon-core';
import { $T } from '../../cores';
import { failure, notfound, success } from 'lemon-core/dist/cores/lambda/lambda-wss-handler';
import { convertWSSEvent, parseMessage } from './tools';
import { ConnectionInfo, SocketActionType, SocketEvent } from './wss-types';
export { SocketPayload, SocketResponse } from './wss-types';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BackendService } from '../../service/backend-service';
import { Context } from 'aws-lambda';
import { HttpHeaderSet, MyHttpHeaderTool } from 'lemon-core/dist/cores/lambda/lambda-web-handler';
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
     * say hello
     */
    public hello = () => `lambda-wss-handler:${this.service.hello()}`;

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
            const { stage } = $info();
            const head = stage?.startsWith('prod') ? `#socket` : `#socket-${stage}`;
            const title = !action ? `${head}/${ROUTE}` : `${head}/${ROUTE}/${action}`;
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
     * builder of tools for http-headers
     * - extracting header content, and parse.
     */
    public tools = (event: WSSEvent): WSSHeaderTool => new WSSHeaderTool(event?.headers, event?.queryStringParameters);

    /**
     * (optional) pack the origin context to application context.
     * - override this function if required!
     *
     * @param event     origin event
     * @param context   origin context of lambda
     * @override `@lemon-core/LambdaHandlerService.packContext`
     */
    public packContext = async (event?: WSSEvent, orgContext?: Context): Promise<NextContext> => {
        _log(NS, `packContext(${event ? '' : 'null'})..`);
        if (!event) return null;
        //* prepare chain object.
        const reqContext = event?.requestContext;
        orgContext && _log(NS, `> orgContext =`, $U.S(orgContext, 256, 32));
        reqContext && _log(NS, `> reqContext =`, $U.S(reqContext, 256, 32));

        // STEP.1 extract the key headers.
        const $tool = this.tools(event);
        const identity = await $tool.parseIdentityHeader();
        const _prepare = (): NextContext => {
            const cookie = $tool.parseCookiesHeader();
            const domain = $tool.getHeader('host');
            const referer = $tool.getHeader('referer');
            const origin = $tool.getHeader('origin');
            const userAgent = $tool.getHeader('user-agent');
            const authorization = $tool.getHeader('authorization');
            return $tool.onlyDefined<NextContext>({
                identity,
                cookie,
                domain,
                referer,
                origin,
                userAgent,
                authorization,
            });
        };

        // STEP.3. prepare the final `next-context`.
        const $ctx = await $tool.prepareContext(_prepare(), reqContext);

        // FINIAL. returns
        return $ctx;
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

    /**
     * post to client
     * @param payload   object or string
     * @param $conn     connection-info
     */
    public async postClientMessage<T extends ConnectionInfo = ConnectionInfo>(payload: any, $event?: T) {
        const { stage, domain, connectionId } = $event;
        if (!domain) throw new Error(`@domain (string) is required!`);
        const url = `https://${domain}/${stage ?? ''}`;
        return this.doSend(url, connectionId, payload);
    }

    /**
     * broadcast message to selected connections
     * @param payload Message payload to send
     * @param list array of connections
     */
    public async doBroadcast<T extends ConnectionInfo = ConnectionInfo>(
        payload: any,
        list: T[],
        options?: { channel?: string },
    ) {
        const errScope = `doBroadcast(${options?.channel ?? ''})`;
        list && _log(NS, `> list@${errScope}.len = `, list.length);

        // STEP.1 prepare the connections
        const $list = list?.map((N, i) => ({ ...N, id: N?.connectionId ?? $T.S2(i) }));

        // STEP.2 send message to each connection
        const $sent = await my_parrallel($list, async N => {
            if (N?.connectionId && N?.stage && N?.domain) {
                return this.postClientMessage(payload, N)
                    .then(() => {
                        return { id: N.id, error: null as string };
                    })
                    .catch(e => {
                        const error = e instanceof Error ? GETERR(e) : e;
                        if (error?.message === '410') return { id: N.id }; //* ignore if `GoneException`
                        _err(NS, `>> conn[${N.id}].err =`, $U.json(error));
                        return { error: e, id: N.id, $conn: N };
                    });
            }
            return null;
        });

        // STEP.3 if on error. do something....
        const errors = $sent.filter(N => N && N.error);
        errors.length && _err(NS, `! errors.len =`, $U.json(errors.map(N => `${N.id}:${N.error}`)));
        if (errors.length > 0) {
            await doReportError(errors[0].error, null, null, { payload, $sent }).catch(GETERR);
        }
        return { $conns: list, $sent, count: $sent.length, errors };
    }
}

/**
 * WSS Header Tool
 */
export class WSSHeaderTool extends MyHttpHeaderTool {
    private queryParams: { [key: string]: string } = {};

    constructor(
        headers?: HttpHeaderSet,
        queryStringParameters?: { [key: string]: string },
        options?: { isClone?: boolean },
    ) {
        super(headers, options);
        this.queryParams = queryStringParameters || {};
    }

    /**
     * get the last value in header by name
     * - if not found in headers, fallback to query parameters.
     * @override
     */
    public getHeader(name: string): string {
        // (1st) check in headers
        const headerValue = super.getHeader(name);
        if (headerValue) return headerValue;
        // (2nd) check in query parameters
        return this.queryParams[name];
    }
}
