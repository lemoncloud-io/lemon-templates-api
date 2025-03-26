/**
 * `model.ts`
 * - model definitions per account data
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * Copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { CoreModel, NextIdentityAccess, SimpleSet } from 'lemon-model';
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
 * type: `MockHead`
 * - common head of mock-model.
 */
export interface MockHead {
    /** id of mock */
    id?: string;
    /** name of mock */
    name?: string;
}

/**
 * `mock`: internal mock model.
 * - provice mocks data
 */
export interface MockModel<T = string> extends MockHead, Model {
    /** name of this model */
    name?: string;
    /** alias-id when stereo='#alias' */
    aliasId?: string;
    /** json encoding all data */
    meta?: T;
}

export interface MockModelExt<T = string> extends MockModel<T> {
    /** extended data with any type */
    [key: string]: any;
}
/**
 * type: `TestHead`
 * - common head of ㅎtest-model.
 */
export interface TestHead {
    /** internal reference */
    _idx?: number;
    /** internal date(YYYY-MM-DD) */
    _date?: string;
}

/**
 * `test`: internal test model.
 */
export interface TestModel extends Model, TestHead {
    /** name of model */
    name?: string;
    /** test count */
    count?: number;

    /** (optional) extra */
    extra?: SimpleSet;

    /**
     * inner Object.
     */
    readonly Model?: Model;

    /**
     * (view) Access Infor.
     */
    readonly $identity?: NextIdentityAccess;
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
    mock: filterFields(keys<MockHead>()),
    test: filterFields(keys<TestHead>()),
};

// extract field names from models
export const $FIELD = {
    mock: filterFields(keys<MockModel>(), ['meta']),
    test: filterFields(keys<TestModel>()),
};

/** must export default as below */
export default { $HEAD, $FIELD };
