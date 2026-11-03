/**
 * `model.ts`
 * - model definitions per account data
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @date        2026-10-28 v5 B4: `MockModel` is a class with `@field()` annotations (no generated registry entry).
 * @date        2026-10-30 v5 B4: `TestModel` is a class too; the generated registry is gone.
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
 * - v5 B4: a class over `CoreModel`; head fields carry `{ group: 'head' }` (was the `TestHead` registry entry).
 */
export class TestModel extends CoreModel<ModelType> implements TestHead {
    //* v5 B4: head fields (`id`/`stereo` are inherited, redeclared to join the head group)
    /** id of head */
    @field({ group: 'head' })
    declare id?: string;
    /** name of model */
    @field({ group: 'head' })
    name?: string;
    /** stereo of model */
    @field({ group: 'head' })
    declare stereo?: TestStereo;
    /** internal reference */
    @field({ group: 'head' })
    _idx?: number;

    /** test count */
    @field()
    count?: number;

    /** (optional) extra */
    @field()
    extra?: SimpleSet;

    /** pinned flag (0 | 1) */
    @field()
    pinned?: 0 | 1;

    /** linked mock id */
    @field()
    mockId?: string;
    /** linked mock head */
    @field()
    mock$?: MockHead;

    /** linked mock ids */
    @field()
    mockIds?: string[];
    /** linked mock heads */
    @field()
    mock$$?: MockHead[];

    /**
     * inner Object. (view field: no `@field()`)
     */
    readonly Model?: Model;

    /** linked mock model (view) */
    readonly $mock?: MockModel;

    /** linked mock models (view) */
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
    //* v5 B4: head group of the annotated class
    test: filterFields(fieldsOf(TestModel, { group: 'head' })),
};

// extract field names from models
export const $FIELD = {
    //* v5 B4: all annotated fields of the class (same set as before; order is parent-first).
    mock: filterFields(fieldsOf(MockModel), ['meta']),
    //* v5 B4: all annotated fields of the class
    test: filterFields(fieldsOf(TestModel)),
};

/** must export default as below */
export default { $HEAD, $FIELD };
