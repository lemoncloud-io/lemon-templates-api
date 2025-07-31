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
 * class: `SocketModel`
 */
export interface SocketModel extends Model {
    /** id of model */
    id?: string;
    /** name of model */
    name?: string;
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
};

/** must export default as below */
export default { $HEAD, $FIELD };
