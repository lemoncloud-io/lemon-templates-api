/**
 * `model.ts`
 * - model definitions per account data
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @author      Aiden <aiden@lemocloud.io>
 * @date        2025-07-23 refactored for sockets service
 *
 * Copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { CoreModel } from 'lemon-model';
import $LUT from './types';
/**
 * type: `ModelType`
 */
export declare type ModelType = keyof typeof $LUT.ModelType;
/**
 * type: `Model`: common model
 */
export declare type Model = CoreModel<ModelType>;
/**
 * interface: `SocketModel`
 */
export interface SocketModel extends Model {
    /** id of model */
    id?: string;
    /** name of model */
    name?: string;
}
/**
 * interface: `ConnectionModel`
 * - a model for each connection to websocket.
 * - 웹소켓 연결 정보를 저장하는 모델
 */
export interface ConnectionModel extends Model {
    /**
     * as `conn-id`
     */
    id?: string;
    /**
     * stereo type as initial `role`.
     */
    stereo?: string;
    /**
     * (required) The deployment stage of the API (e.g., 'dev', 'prod').
     */
    stage?: string;
    /**
     * (required) The domain name of the WebSocket API.
     */
    domain?: string;
    /**
     * (required) The unique identifier for the WebSocket connection.
     */
    connectionId?: string;
    /** (internal) count of connected items */
    connected?: number;
    /** (internal) count of granted items */
    granted?: number;
    /** (internal) Timestamp when the connection was established. */
    connectedAt?: number;
    /** (internal) Timestamp when the connection was terminated. */
    disConnectedAt?: number;
    /**
     * (extended) The origin of the request.
     */
    origin?: string;
    /**
     * (extended) The remote IP address of the client.
     */
    remote?: string;
    /**
     * (extended) The User-Agent string of the client.
     */
    agent?: string;
    /**
     * (extended) The reason for disconnection, if applicable.
     */
    reason?: string;
    /**
     * (extended) The code of disconnection.
     */
    disconnectCode?: number;
}
/**
 * extract field names from models
 * - only fields start with lowercase, or all upper.
 */
export declare const filterFields: (fields: string[], base?: string[]) => string[];
/** field names from head */
export declare const $HEAD: {};
export declare const $FIELD: {
    socket: string[];
    connection: string[];
};
/** must export default as below */
declare const _default: {
    $HEAD: {};
    $FIELD: {
        socket: string[];
        connection: string[];
    };
};
export default _default;
