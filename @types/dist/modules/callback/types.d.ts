/**
 * `types.ts`
 * - basic types used in `proxy`
 *
 * **[중요! exports 순서]**
 * 1. define data type in `types.ts` w/ internal types.
 * 2. define Model in `model.ts`
 * 3. define View/Body in `view.ts`, and external types.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
/**
 * Lookup Table
 *
 * WARN! DO NOT EXPORT AS `$LUT`. use default export instead.
 */
declare const $LUT: {
    /**
     * Possible type of model.
     */
    ModelType: {
        /** callback model */
        callback: string;
    };
    /**
     * 콜백의 종류
     */
    CallbackStereo: {
        '': string;
        /** # means not to index */
        '#': string;
    };
    /**
     * 콜백의 상태
     */
    CallbackState: {
        '': string;
        requested: string;
        responsed: string;
    };
};
/**
 * type: `CallbackStereo`
 */
export declare type CallbackStereo = keyof typeof $LUT.CallbackStereo;
/**
 * type: `CallbackState`
 */
export declare type CallbackState = keyof typeof $LUT.CallbackState;
/** must export $LUT as default */
export default $LUT;
