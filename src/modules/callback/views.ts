/**
 * `views.ts`
 * - type of views used in `transformer`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
//* v5 B16: lemon-model through lemon-core
import { View, Body } from 'lemon-core';
import { CallbackModel } from './model';
import $LUT from './types';

//! export all internal types
export * from './types';
export default $LUT;

/**
 * type `CallbackView`
 */
export interface CallbackView extends View, Omit<Partial<CallbackModel>, 'optional' | 'hidden'> {
    /** 사용 활성화 여부 */
    optional?: boolean;
    /**
     * hidden(숨김) flag
     */
    hidden?: boolean;
}
/**
 * type `CallbackBody`
 */
export interface CallbackBody extends Body, Partial<Omit<CallbackView, ''>> {}
