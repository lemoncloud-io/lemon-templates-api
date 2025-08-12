/**
 * `tools.ts`
 * - main library for sockets
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2020-06-30 initial version
 * @author      Aiden <aiden@lemoncloud.io>
 * @date        2025-07-31 refactored for WebSocket support
 *
 * @copyright   (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-cluster-api/cluster`
 */

import { $U, GETERR, WSSEvent } from 'lemon-core';
import $LUT, { SocketEvent, SocketPayload, SocketResponse, SocketActionType } from './wss-types';
import { $T, onlyDefined } from '../cores';

/**
 * base64 encoding/decoding for parsing `connection-id`
 */
export const $base64 = {
    encode: (unencoded: string, enc: any = 'utf8') => Buffer.from(unencoded || '', enc).toString('base64'),
    decode: (encoded: string, out: any = 'utf8') => Buffer.from(encoded || '', 'base64').toString(out),
    urlEncode: (unencoded: string) => $base64.encode(unencoded, 'hex').replace(/\+/g, '-').replace(/\//g, '_'),
    urlDecode: (encoded: string) => {
        if (!encoded) return '';
        encoded = encoded.replace('-', '+').replace('_', '/');
        while (encoded.length % 4) encoded += '=';
        return $base64.decode(encoded, 'hex');
    },
};

/**
 * parse the encoded string to base64.
 * @param body string
 */
export const parseBase64 = (body: string): string => $base64.urlDecode(`${body || ''}`);

/**
 * parse the encoded json to JSON.
 * @param body any data
 */
export const parseBody = (body: any, key: string = 'body') => {
    try {
        return body && typeof body == 'string' && body.startsWith('{') && body.endsWith('}')
            ? JSON.parse(body)
            : { [key]: body };
    } catch (e) {
        return { [key]: body, error: GETERR(e) };
    }
};
/**
 * parse the recieved message
 * @param data string | object
 */
export const parseMessage = <T = any>(data: any): SocketPayload<T> => {
    if (typeof data !== 'string') return { action: '', data: data as T };
    const $cmd = !data.startsWith('{') ? { action: data } : parseBody(data, 'data'); //! data must be `string`
    const action = $cmd && $cmd?.action ? $T.asLut($cmd?.action, $LUT.ActionType, 'action') : '';
    return { ...$cmd, action };
};

/**
 * build WebSocket response message
 * @param action - action type for the response
 * @param data - response data payload
 * @returns SocketResponse with action and data
 */
export const buildSocketResponse = <T = any>(
    action: SocketActionType,
    result?: T,
    options?: { current?: number },
): SocketResponse<T> => {
    const timestamp = options?.current ?? $U.current_time_ms();
    return { action, timestamp, result };
};

/**
 * translate the origin event to socket-event
 */
export const convertWSSEvent = (event?: WSSEvent): SocketEvent => {
    const $hdr = event && event.headers;
    let authorization = `${($hdr && $hdr.Authorization) || ''}`;
    const origin = `${($hdr && $hdr['Origin']) || ''}`;
    const param = { ...(event && event.queryStringParameters) };

    const $req: any = event && event.requestContext;
    const $idt: any = $req?.identity;
    const id = `${$req?.requestId || ''}`;
    const type = `${$req?.eventType || ''}` as SocketEvent['type'];
    const route = `${$req?.routeKey || ''}` as SocketEvent['route'];
    const stage = `${$req?.stage || ''}` as SocketEvent['stage'];
    const remote = `${($hdr && $hdr['X-Forwarded-For']) || ($idt && $idt['sourceIp']) || ''}`;
    const agent = `${($hdr && $hdr['User-Agent']) || ($idt && $idt['userAgent']) || ''}`;
    const direction = `${$req?.messageDirection || ''}` as SocketEvent['direction'];
    const reason = `${$req?.disconnectReason || ''}`;
    const domain = $U.env('WSS_DOMAIN', `${$req?.domainName || ''}`);
    const connectionId = `${$req?.connectionId || ''}`;
    const messageId = `${$req?.messageId || ''}`;
    const apiId = `${$req?.apiId || ''}`;
    const connectedAt = $req?.connectedAt || 0;
    const disconnectCode = $req?.disconnectStatusCode ?? 0;
    const body = event && event.body;

    // extract `auth` from query.
    const $qs = event && event.queryStringParameters;
    if ($qs && $qs['auth']) authorization = authorization || `Basic ${$qs.auth}`.trim();

    //! returns;
    return onlyDefined<SocketEvent>({
        id,
        type,
        route,
        authorization,
        origin,
        param,
        stage,
        remote,
        agent,
        direction,
        reason,
        domain,
        connectionId,
        messageId,
        apiId,
        connectedAt,
        disconnectCode,
        body,
    });
};
