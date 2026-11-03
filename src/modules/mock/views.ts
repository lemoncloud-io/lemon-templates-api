/**
 * `views.ts`
 * - type of views used in `backend-proxy`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * Copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
//* v5 B16: lemon-model through lemon-core
import { View, Body } from 'lemon-core';
import { MockModel, TestModel } from './model';
import $LUT from './types';

//! export all internal types
export * from './types';
export default $LUT;

/**!SECTION */
/**
 * type: `MockView`
 * - usually same as post's body.
 */
export interface MockView extends View, Omit<Partial<MockModel>, 'required'> {
    /**
     * (optional) flag required.
     */
    required?: boolean;
}

/**
 * Type `MockBody`
 */
export interface MockBody extends Body, Partial<MockView> {}

/**
 * Type `TestBody`
 */
export interface TestBody extends Body, Partial<TestView> {}
/**
 * type: `TestView`
 * - usually same as post's body.
 */
export interface TestView
    extends View,
        Omit<Partial<TestModel>, 'id' | 'required' | 'pinned' | 'mock$' | 'mock$$' | '$mock' | '$mocks'> {
    /**
     * unique id of this type
     */
    id: string;

    /**
     * (optional) flag required.
     */
    required?: boolean;

    /** pinned flag (stored as 0 | 1) */
    pinned?: boolean;

    /** linked mock resolved from `mockId` */
    mock$?: MockView;

    /** linked mocks resolved from `mockIds` */
    mock$$?: MockView[];
}
