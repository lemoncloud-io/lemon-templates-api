/**
 * `socket-types.ts`
 * - main types for sockets
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

/**
 * shared common model for connection.
 */
export interface ConnectionInfo {
    /**
     * stage of api-gateway
     */
    stage?: string;
    /**
     * connected domain
     */
    domain?: string;
    /**
     * connection-id
     */
    connectionId?: string;
}
/**
 * interface: `SocketPayload`
 * - WebSocket message payload structure
 */
export interface SocketPayload<T = any> {
    /**
     * action type to determine message handling
     */
    action: SocketActionType | string;
    /**
     * message data
     */
    data: T;
}

/**
 * interface: `SocketResponse`
 * - WebSocket response structure
 * - extends SocketPayload with response-specific features
 */
export interface SocketResponse<T = any> {
    /**
     * response status type
     */
    action: SocketActionType;
    /**
     * response data
     */
    result?: T;
    /**
     * response timestamp
     */
    timestamp: number;
}

/**
 * socket event content
 */
export interface SocketEvent extends ConnectionInfo {
    /**
     * reguest-id
     */
    id: string;
    type: 'CONNECT' | 'DISCONNECT' | 'MESSAGE' | '';
    route: '$connect' | '$disconnect' | '$default' | '';
    authorization: string;
    stage: 'dev' | 'prod' | '';
    direction: 'IN' | 'OUT' | '';
    reason: string;
    domain: string;
    origin: string;
    agent: string;
    connectionId: string;
    messageId: string;
    apiId: string;
    connectedAt: number;
    /**
     * remote-api address
     */
    remote: string;
    /**
     * query parameters...
     */
    param: { [key: string]: string };
    /**
     * body
     */
    body?: string;
}

/**
 * lookup table
 */
const $LUT = {
    /**
     * ActionType
     */
    ActionType: {
        '': '',
        /** ping */
        ping: 'ping',
        /** pong */
        pong: 'pong',
        /** echo */
        echo: 'echo',
        /** message */
        message: 'message',
        /** auth */
        auth: 'auth',
        /** success */
        success: 'success',
        /** error */
        error: 'error',
        /** unknown */
        unknown: 'unknown',
    },
};

/**
 * type: `SocketActionType`
 */
export type SocketActionType = keyof typeof $LUT.ActionType;

export default $LUT;
