/**
 * `model.ts`
 * - model definitions
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 * @date        2026-10-30 v5 B4: `CallbackModel` is a class with `@field()` annotations (no generated registry).
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
//* v5 B16: lemon-model through lemon-core
import { CoreModel } from 'lemon-core';
//* v5 B4: field annotations (lemon-model through the `lemon-core/model` sub-path)
import { field, fieldsOf } from 'lemon-core/model';
//WARN - DO NOT IMPORT FROM `../../service/backend-model`
// import { ModelType } from '../../service/backend-types';
import $LUT, { CallbackState, CallbackStereo } from './types';

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
 * - v5 B4: a class over `CoreModel`; head fields carry `{ group: 'head' }` (was the `CallbackHead` registry entry).
 */
export class CallbackModel extends CoreModel<ModelType> implements CallbackHead {
    //* v5 B4: head fields (`id`/`stereo` are inherited, redeclared to join the head group)
    /** auto-seq or child-no */
    @field({ group: 'head' })
    declare id?: string;
    /** stereo */
    @field({ group: 'head' })
    declare stereo?: CallbackStereo;
    /** name of callback */
    @field({ group: 'head' })
    name?: string;

    /** domain of origin context */
    @field()
    domain?: string;
    /** client-ip requested */
    @field()
    clientIp?: string;
    /** user-agent requested */
    @field()
    userAgent?: string;

    /** state of callback */
    @field()
    state?: CallbackState;

    /** (optional) parent of this */
    @field()
    parentId?: string;
    /** parent info */
    @field()
    parent$?: CallbackHead;

    /** (optional) child-no to tracking */
    @field()
    no?: number;

    /** target url */
    @field()
    target?: string;
    /** queue-id */
    @field()
    qid?: string;
    /** callback handler */
    @field()
    handler?: string;
    /** callback result */
    @field()
    result?: string;

    /** time of requested */
    @field()
    requestedAt?: number;
    /** time of responsed */
    @field()
    responsedAt?: number;

    /** request-info (will be exchanged with `.meta`) - view field: no `@field()` */
    readonly $request?: CallbackRequest;
    /** request meta in json */
    @field()
    declare meta?: string;

    /**
     * hidden(숨김) flag
     */
    @field()
    hidden?: BoolFlag;
    /**
     * optional(선택) flag
     */
    @field()
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
    //* v5 B4: head group of the annotated class
    callback: filterFields(fieldsOf(CallbackModel, { group: 'head' })),
};

// extract field names from models
export const $FIELD = {
    //* v5 B4: all annotated fields of the class
    callback: filterFields(fieldsOf(CallbackModel)),
};

/** must export default as below */
export default { $HEAD, $FIELD };
