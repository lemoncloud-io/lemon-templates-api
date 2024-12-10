/**
 * `transformer.spec.ts`
 * - `transformer` test
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/ssocio-templates-api/cores` (WARN! keep in same origin)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2 } from 'lemon-core';
import { $T } from './commons';

const $LUT = {
    /**
     * Possible type of language.
     */
    Languages: {
        '': null,
        ko: 'Korean',
        en: 'English',
    } as { [key: string]: string },
};

//! main test body.
describe('commons', () => {
    it('should pass asLut', async () => {
        expect2(() => $T.asLut('some', $LUT.Languages, 'lang')).toEqual('.lang[some] is invalid!');
        expect2(() => $T.asLut('ko', $LUT.Languages, 'lang')).toEqual('ko');
        expect2(() => $T.asLut('en', $LUT.Languages, 'lang')).toEqual('en');
        expect2(() => $T.asLut('Korean', $LUT.Languages, 'lang')).toEqual('ko');
        expect2(() => $T.asLut(null, $LUT.Languages, 'lang')).toEqual('');
        expect2(() => $T.asLut('', $LUT.Languages, 'lang')).toEqual('');
    });
});
