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
        /** 1000 - 정상 종료 */
        1000: 'NORMAL_CLOSURE',
        /** 1001 - 서버 종료/페이지 이동 */
        1001: 'GOING_AWAY',
        /** 1002 - 프로토콜 오류 */
        1002: 'PROTOCOL_ERROR',
        /** 1003 - 지원하지 않는 데이터 */
        1003: 'UNSUPPORTED_DATA',
        /** 1005 - 상태 코드 없음 */
        1005: 'NO_STATUS_RECEIVED',
        /** 1006 - 비정상 종료 */
        1006: 'ABNORMAL_CLOSURE',
        /** 1007 - 잘못된 프레임 */
        1007: 'INVALID_FRAME_PAYLOAD',
        /** 1008 - 정책 위반 */
        1008: 'POLICY_VIOLATION',
        /** 1009 - 메시지 크기 초과 */
        1009: 'MESSAGE_TOO_BIG',
        /** 1011 - 서버 내부 오류 */
        1011: 'INTERNAL_ERROR',
        /** 1012 - 서비스 재시작 */
        1012: 'SERVICE_RESTART',
        /** 1013 - 나중에 다시 시도 */
        1013: 'TRY_AGAIN_LATER',
        /** 1015 - TLS 핸드셰이크 실패 */
        1015: 'TLS_HANDSHAKE',
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

export default $LUT;
