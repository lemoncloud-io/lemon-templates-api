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
    param: {
        [key: string]: string;
    };
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
declare const $LUT: {
    /**
     * ActionType
     */
    ActionType: {
        '': string;
        /** ping */
        ping: string;
        /** pong */
        pong: string;
        /** echo */
        echo: string;
        /** message */
        message: string;
    };
    /**
     * EventType
     */
    EventType: {
        '': string;
        /** CONNECT */
        CONNECT: string;
        /** DISCONNECT  */
        DISCONNECT: string;
        /** MESSAGE */
        MESSAGE: string;
    };
    /**
     * RouteKeyType
     */
    RouteKeyType: {
        /** $connect */
        $connect: string;
        /** $disconnect */
        $disconnect: string;
        /** $default */
        $default: string;
        /** echo */
        echo: string;
    };
    /**
     * StageType
     */
    StageType: {
        '': string;
        /** dev */
        dev: string;
        /** prod */
        prod: string;
        /** local */
        local: string;
    };
    /**
     * DirectionType
     */
    DirectionType: {
        '': string;
        /** IN */
        IN: string;
        /** OUT */
        OUT: string;
    };
    /**
     * DisconnectStatusCode
     */
    DisconnectStatusCode: {
        /** 1000 - Normal closure */
        1000: string;
        /** 1001 - Server shutdown/page navigation */
        1001: string;
        /** 1002 - Protocol error */
        1002: string;
        /** 1003 - Unsupported data */
        1003: string;
        /** 1005 - No status code received */
        1005: string;
        /** 1006 - Abnormal closure */
        1006: string;
        /** 1007 - Invalid frame payload */
        1007: string;
        /** 1008 - Policy violation */
        1008: string;
        /** 1009 - Message too big */
        1009: string;
        /** 1011 - Internal server error */
        1011: string;
        /** 1012 - Service restart */
        1012: string;
        /** 1013 - Try again later */
        1013: string;
        /** 1015 - TLS handshake failure */
        1015: string;
    };
    /**
     * MessageActionType
     */
    MessageActionType: {
        '': string;
        /** create */
        create: string;
        /** update */
        update: string;
        /** delete */
        delete: string;
    };
};
/**
 * type: `SocketActionType`
 */
export declare type SocketActionType = keyof typeof $LUT.ActionType;
/**
 * type: `SocketEventType`
 */
export declare type SocketEventType = keyof typeof $LUT.EventType;
/**
 * type: `SocketRouteKey`
 */
export declare type SocketRouteKeyType = keyof typeof $LUT.RouteKeyType;
/**
 * type: `SocketStage`
 */
export declare type SocketStageType = keyof typeof $LUT.StageType;
/**
 * type: `SocketDirectionType`
 */
export declare type SocketDirectionType = keyof typeof $LUT.DirectionType;
/**
 * type: `DisconnectStatusCode`
 */
export declare type DisconnectStatusCode = keyof typeof $LUT.DisconnectStatusCode;
/**
 * type: `MessageActionType`
 */
export declare type MessageActionType = keyof typeof $LUT.MessageActionType;
export default $LUT;
