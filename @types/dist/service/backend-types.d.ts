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
export { SimpleSet };
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
        mock: string;
        test: string;
        callback: string;
        socket: string;
        connection: string; /** Korean */
    };
    /**
     * Possible type of language.
     */
    Languages: {
        /** no selection */
        '': string;
        /** Korean */
        ko: string;
        /** English */
        en: string;
        /** Chinese */
        cn: string;
    };
};
/**
 * type: `ModelType`
 */
export declare type ModelType = keyof typeof $LUT.ModelType;
/**
 * type: `LanguageType`
 */
export declare type LanguageType = keyof typeof $LUT.Languages;
/** must export $LUT as default */
export default $LUT;
