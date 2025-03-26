/**
 * `model.ts`
 * - model definitions
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
import { CoreModel } from 'lemon-model';
//WARN - DO NOT IMPORT FROM `../../service/backend-model`
// import { ModelType } from '../../service/backend-types';
import $LUT, { CallbackStereo } from './types';
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
 * type: boolean style number.
 */
export type BoolFlag = 0 | 1;

/**
 * Type: `CallbackHead`
 */
export interface CallbackHead {
    /** auto sequence */
    id?: string;
    /** stereo */
    stereo?: CallbackStereo;
    /** name of callback */
    name?: string;
}

/**
 * type: `CallbackModel` (카테고리)
 * - 카테고리(분류) 모델
 */
export interface CallbackModel extends Model, CallbackHead {
    /** stereo */
    stereo?: CallbackStereo;
    /** name of callback */
    name?: string;

    /**
     * hidden(숨김) flag
     */
    hidden?: BoolFlag;
    /**
     * optional(선택) flag
     */
    optional?: BoolFlag;
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
export const $HEAD = {
    callback: filterFields(keys<CallbackHead>()),
};

// extract field names from models
export const $FIELD = {
    callback: filterFields(keys<CallbackModel>()),
};

/** must export default as below */
export default { $HEAD, $FIELD };
