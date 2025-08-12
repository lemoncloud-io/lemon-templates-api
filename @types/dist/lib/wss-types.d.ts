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
     * request-id
     */
    id: string;
    type: SocketEventType;
    route: SocketRouteKeyType;
    authorization: string;
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
        /** auth */
        auth: string;
        /** success */
        success: string;
        /** error */
        error: string;
        /** unknown */
        unknown: string;
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
        /** 1000 - 정상 종료 */
        1000: string;
        /** 1001 - 서버 종료/페이지 이동 */
        1001: string;
        /** 1002 - 프로토콜 오류 */
        1002: string;
        /** 1003 - 지원하지 않는 데이터 */
        1003: string;
        /** 1005 - 상태 코드 없음 */
        1005: string;
        /** 1006 - 비정상 종료 */
        1006: string;
        /** 1007 - 잘못된 프레임 */
        1007: string;
        /** 1008 - 정책 위반 */
        1008: string;
        /** 1009 - 메시지 크기 초과 */
        1009: string;
        /** 1011 - 서버 내부 오류 */
        1011: string;
        /** 1012 - 서비스 재시작 */
        1012: string;
        /** 1013 - 나중에 다시 시도 */
        1013: string;
        /** 1015 - TLS 핸드셰이크 실패 */
        1015: string;
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
export default $LUT;
