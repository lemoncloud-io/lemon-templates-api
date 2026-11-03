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
import { CoreModel, NextIdentityAccess, SimpleSet } from 'lemon-model';
import $LUT, { MockStereo, TestStereo } from './types';
/**
 * type: `ModelType`
 */
export declare type ModelType = keyof typeof $LUT.ModelType;
/**
 * type: `Model`: common model
 */
export declare type Model = CoreModel<ModelType>;
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
export declare class MockModel<T = string> extends CoreModel<ModelType> implements MockHead {
    /** id of mock */
    id?: string;
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
 * - v5 B4: a class over `CoreModel`; head fields carry `{ group: 'head' }` (was the `TestHead` registry entry).
 */
export declare class TestModel extends CoreModel<ModelType> implements TestHead {
    /** id of head */
    id?: string;
    /** name of model */
    name?: string;
    /** stereo of model */
    stereo?: TestStereo;
    /** internal reference */
    _idx?: number;
    /** test count */
    count?: number;
    /** (optional) extra */
    extra?: SimpleSet;
    /** pinned flag (0 | 1) */
    pinned?: 0 | 1;
    /** linked mock id */
    mockId?: string;
    /** linked mock head */
    mock$?: MockHead;
    /** linked mock ids */
    mockIds?: string[];
    /** linked mock heads */
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
export declare const filterFields: (fields: string[], base?: string[]) => string[];
/** field names from head */
export declare const $HEAD: {
    mock: string[];
    test: string[];
};
export declare const $FIELD: {
    mock: string[];
    test: string[];
};
/** must export default as below */
declare const _default: {
    $HEAD: {
        mock: string[];
        test: string[];
    };
    $FIELD: {
        mock: string[];
        test: string[];
    };
};
export default _default;
