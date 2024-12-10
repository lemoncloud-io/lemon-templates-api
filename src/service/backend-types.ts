/**
 * `backend-types.ts`
 * - types used in `backend-proxy`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * Copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { SimpleSet } from 'lemon-model';
import $mocks from '../modules/mock/types';
export { SimpleSet };

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
        //* use sub-modules.
        ...$mocks.ModelType,
    },
    /**
     * Possible type of language.
     */
    Languages: {
        /** no selection */
        '': '',
        /** Korean */
        ko: 'Korean',
        /** English */
        en: 'English',
        /** Chinese */
        cn: 'Chinese',
    },
};

/**
 * type: `ModelType`
 */
export type ModelType = keyof typeof $LUT.ModelType;

/**
 * type: `LanguageType`
 */
export type LanguageType = keyof typeof $LUT.Languages;

/** must export $LUT as default */
export default $LUT;
