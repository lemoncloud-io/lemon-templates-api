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
import $LUT, { CallbackState, CallbackStereo } from './types';
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

/** request to target api */
export interface CallbackRequest<Param = any, Body = any> {
    /** parameter */
    param?: Param;
    /** body to call */
    body?: Body;

    /** service name (ex: lemon-hello-api) */
    service?: string;
    /** type name (ex: hello) */
    type?: string;
    /** id of type */
    id?: string;
    /** cmd */
    cmd?: string;
}

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
 * type: `CallbackModel` (콜백)
 * - 콜백 모델
 * - 콜백 요청과 응답에 대한 내용을 기록 관리하기 위함.
 */
export interface CallbackModel extends Model, CallbackHead {
    /** auto-seq or child-no */
    id?: string;
    /** stereo */
    stereo?: CallbackStereo;
    /** name of callback */
    name?: string;

    /** state of callback */
    state?: CallbackState;

    /** (optional) parent of this */
    parentId?: string;
    /** parent info */
    parent$?: CallbackHead;

    /** (optional) child-no to tracking */
    no?: number;

    /** target url */
    target?: string;
    /** queue-id */
    qid?: string;
    /** callback handler */
    handler?: string;
    /** callback result */
    result?: string;

    /** time of requested */
    requestedAt?: number;
    /** time of responsed */
    responsedAt?: number;

    /** request-info (will be exchanged with `.meta`) */
    readonly $request?: CallbackRequest;

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
