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
import $LUT, { MockStereo, TestStereo } from './types';
import { fieldKeys } from '../../generated/field-registry';

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
    /** stereo of mock */
    stereo?: MockStereo | ModelType;
}

/**
 * `mock`: internal mock model.
 * - provice mocks data
 */
export interface MockModel<T = string> extends MockHead, Model {
    /** name of this model */
    name?: string;
    /** stereo of this model */
    stereo?: MockStereo | ModelType;
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
 * - common head of test-model.
 */
export interface TestHead {
    /** id of head */
    id?: string;
    /** name of model */
    name?: string;
    /** stereo of model */
    stereo?: TestStereo;
    /** internal reference */
    _idx?: number;
}

/**
 * `test`: internal test model.
 */
export interface TestModel extends Model, TestHead {
    /** name of model */
    name?: string;
    /** stereo of model */
    stereo?: TestStereo;

    /** test count */
    count?: number;

    /** (optional) extra */
    extra?: SimpleSet;

    /** linked mock id */
    mockId?: string;
    /** linked mock head */
    mock$?: MockHead;

    /** linked mock ids */
    mockIds?: string[];
    /** linked mock heads */
    mock$$?: MockHead[];

    /**
     * inner Object.
     */
    readonly Model?: Model;

    /** linked mock model */
    readonly $mock?: MockModel;

    /** linked mock models */
    readonly $mocks?: MockModel[];

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
    mock: filterFields(fieldKeys.mockHead<MockHead>()),
    test: filterFields(fieldKeys.testHead<TestHead>()),
};

// extract field names from models
export const $FIELD = {
    mock: filterFields(fieldKeys.mockModel<MockModel>(), ['meta']),
    test: filterFields(fieldKeys.mockTestModel<TestModel>()),
};

/** must export default as below */
export default { $HEAD, $FIELD };
