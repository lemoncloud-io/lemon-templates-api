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
    /**
     * timestamp in number
     */
    timestamp?: number;
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
    action: SocketActionType | string;
    /**
     * response data
     */
    data?: T;
    /**
     * timestamp in `YYYY-MM-DD HH:mm:ss`
     */
    ts?: string;
    /**
     * id of the channel
     * - channel to which the message was sent.
     */
    channel?: string;
}

/**
 * socket event content
 */
export interface SocketEvent extends ConnectionInfo {
    /**
     * request-id
     */
    id: string;
    type: SocketEventType;
    route: SocketRouteKeyType;
    authorization?: string;
    stage: SocketStageType;
    direction: SocketDirectionType;
    disconnectCode?: DisconnectStatusCode;
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
 * interface: `SocketMessage`
 * - Message structure used when external services send WebSocket requests
 */
export interface SocketMessagePayload<T extends SocketModelMeta = SocketModelMeta> {
    /**
     * Name of the service that sent the message
     * - ex) `lemon-orders-api`, `lemon-payments-api`
     */
    service: string;
    /**
     * Resource (modelType) name of the channel that sent the message
     * - ex) `order`, `payment`, `user`
     */
    modelType: string;
    /**
     * event type
     */
    event?: MessageActionType;
    /**
     * timestamp in `YYYY-MM-DD HH:mm:ss`
     */
    ts?: string;
    /**
     * message data
     */
    data?: T;
}

/**
 * interface: `SocketModelMeta`
 * - 외부 서비스의 모델 메타데이터.
 */
export interface SocketModelMeta {
    /** id of model */
    id?: string;
    /** type of model */
    type?: string;
    /** sid of model */
    sid?: string;
    /** uid of model */
    uid?: string;
    /** gid of model */
    gid?: string;
    /** oid of model (owner) */
    oid?: string;
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
    },
    /**
     * EventType
     */
    EventType: {
        '': '',
        /** CONNECT */
        CONNECT: 'CONNECT',
        /** DISCONNECT  */
        DISCONNECT: 'DISCONNECT',
        /** MESSAGE */
        MESSAGE: 'MESSAGE',
    },
    /**
     * RouteKeyType
     */
    RouteKeyType: {
        /** $connect */
        $connect: '$connect',
        /** $disconnect */
        $disconnect: '$disconnect',
        /** $default */
        $default: '$default',
        /** echo */
        echo: 'echo',
    },
    /**
     * StageType
     */
    StageType: {
        '': '',
        /** dev */
        dev: 'dev',
        /** prod */
        prod: 'prod',
        /** local */
        local: 'local',
    },
    /**
     * DirectionType
     */
    DirectionType: {
        '': '',
        /** IN */
        IN: 'IN',
        /** OUT */
        OUT: 'OUT',
    },
    /**
     * DisconnectStatusCode
     */
    DisconnectStatusCode: {
        /** 1000 - Normal closure */
        1000: 'NORMAL_CLOSURE',
        /** 1001 - Server shutdown/page navigation */
        1001: 'GOING_AWAY',
        /** 1002 - Protocol error */
        1002: 'PROTOCOL_ERROR',
        /** 1003 - Unsupported data */
        1003: 'UNSUPPORTED_DATA',
        /** 1005 - No status code received */
        1005: 'NO_STATUS_RECEIVED',
        /** 1006 - Abnormal closure */
        1006: 'ABNORMAL_CLOSURE',
        /** 1007 - Invalid frame payload */
        1007: 'INVALID_FRAME_PAYLOAD',
        /** 1008 - Policy violation */
        1008: 'POLICY_VIOLATION',
        /** 1009 - Message too big */
        1009: 'MESSAGE_TOO_BIG',
        /** 1011 - Internal server error */
        1011: 'INTERNAL_ERROR',
        /** 1012 - Service restart */
        1012: 'SERVICE_RESTART',
        /** 1013 - Try again later */
        1013: 'TRY_AGAIN_LATER',
        /** 1015 - TLS handshake failure */
        1015: 'TLS_HANDSHAKE',
    },
    /**
     * MessageActionType
     */
    MessageActionType: {
        '': '',
        /** create */
        create: 'create',
        /** update */
        update: 'update',
        /** delete */
        delete: 'delete',
    },
};

/**
 * type: `SocketActionType`
 */
export type SocketActionType = keyof typeof $LUT.ActionType;

/**
 * type: `SocketEventType`
 */
export type SocketEventType = keyof typeof $LUT.EventType;

/**
 * type: `SocketRouteKey`
 */
export type SocketRouteKeyType = keyof typeof $LUT.RouteKeyType;

/**
 * type: `SocketStage`
 */
export type SocketStageType = keyof typeof $LUT.StageType;

/**
 * type: `SocketDirectionType`
 */
export type SocketDirectionType = keyof typeof $LUT.DirectionType;

/**
 * type: `DisconnectStatusCode`
 */
export type DisconnectStatusCode = keyof typeof $LUT.DisconnectStatusCode;

/**
 * type: `MessageActionType`
 */
export type MessageActionType = keyof typeof $LUT.MessageActionType;

export default $LUT;
