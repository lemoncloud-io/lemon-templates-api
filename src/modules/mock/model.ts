/**
 * `model.ts`
 * - model definitions per account data
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @date        2026-10-28 v5 B4: `MockModel` is a class with `@field()` annotations (no generated registry entry).
 *
 * Copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
//* v5 B16: lemon-model through lemon-core
import { CoreModel, NextIdentityAccess, SimpleSet } from 'lemon-core';
//* v5 B4: field annotations (lemon-model 5.0.0; not on the lemon-core root).
//* v5 B16: lemon-model through lemon-core (`lemon-core/model` sub-path)
import { field, fieldsOf } from 'lemon-core/model';
//WARN - DO NOT IMPORT FROM `../../service/backend-model`
// import { ModelType } from '../../service/backend-types';
import $LUT, { MockStereo, TestStereo } from './types';
//* the other models still use the generated registry (v5 B4 transition: only `MockModel` is annotated).
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
 * - v5 B4: a class over `CoreModel`; head fields carry `{ group: 'head' }` (was the `MockHead` registry entry).
 */
export class MockModel<T = string> extends CoreModel<ModelType> implements MockHead {
    // head fields: `id` is inherited (kind `internal` kept by the option merge), redeclared to join the head group
    /** id of mock */
    @field({ group: 'head' })
    declare id?: string;
    /** name of this model */
    @field({ group: 'head' })
    declare name?: string;
    /** stereo of this model */
    @field({ group: 'head' })
    declare stereo?: MockStereo | ModelType;

    // body fields
    /** alias-id when stereo='#alias' */
    @field()
    aliasId?: string;
    /** json encoding all data */
    @field()
    declare meta?: T;
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
    //* v5 B4: head group of the annotated class (same set as before; order is parent-first).
    mock: filterFields(fieldsOf(MockModel, { group: 'head' })),
    test: filterFields(fieldKeys.testHead<TestHead>()),
};

// extract field names from models
export const $FIELD = {
    //* v5 B4: all annotated fields of the class (same set as before; order is parent-first).
    mock: filterFields(fieldsOf(MockModel), ['meta']),
    test: filterFields(fieldKeys.mockTestModel<TestModel>()),
};

/** must export default as below */
export default { $HEAD, $FIELD };
