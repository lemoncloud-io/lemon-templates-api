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
const $LUT = {
    /**
     * Possible type of model.
     */
    ModelType: {
        /** callback model */
        callback: 'callback',
    },
    /**
     * 카테고리의 종류
     */
    CallbackStereo: {
        '': '',
        /** # means not to index */
        '#': '#',
    },
};

/**
 * type: `MockStereo`
 */
export type CallbackStereo = keyof typeof $LUT.CallbackStereo;

/** must export $LUT as default */
export default $LUT;
