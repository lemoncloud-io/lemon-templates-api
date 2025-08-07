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
//WARN - DO NOT IMPORT FROM `../../service/backend-model`
// import { ModelType } from '../../service/backend-types';
import $LUT from './types';
import { keys } from 'ts-transformer-keys';
/**
 * type: `ModelType`
 */
export type ModelType = keyof typeof $LUT.ModelType;

/**
 * type: `Model`: common model
 */
export type Model = CoreModel<ModelType>;

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
}

/**
 * extract field names from models
 * - only fields start with lowercase, or all upper.
 */
export const filterFields = (fields: string[], base: string[] = []) =>
    fields
        .filter(field => field !== '_id' && /^[a-z_][a-zA-Z_]+/.test(field))
        .reduce<string[]>(
            (L, k) => {
                if (k && !L.includes(k)) L.push(k);
                return L;
            },
            [...base],
        );

/** field names from head */
export const $HEAD = {};

// extract field names from models
export const $FIELD = {
    socket: filterFields(keys<SocketModel>(), ['meta']),
    connection: filterFields(keys<ConnectionModel>(), ['meta']),
};

/** must export default as below */
export default { $HEAD, $FIELD };
