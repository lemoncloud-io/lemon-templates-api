/**
 * `types.ts`
 * - 기본 types used in `backend-proxy`
 *
 * **[중요! exports 순서]**
 * 1. define data type in `types.ts` w/ internal types.
 * 2. define Model in `model.ts`
 * 3. define View/Body in `view.ts`, and external types.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * Copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
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
        /** mock model */
        mock: '목업',
        /** test model */
        test: '테스트',
    },
    /** type: MockStereo */
    MockStereo: {
        '': '',
        '#': 'dummy', // dummy.
        '#alias': 'alias', // alias.
    },
};

/**
 * type: `MockStereo`
 */
export type MockStereo = keyof typeof $LUT.MockStereo;

/** must export $LUT as default */
export default $LUT;
