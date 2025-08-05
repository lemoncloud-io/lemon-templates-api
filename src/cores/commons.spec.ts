/**
 * `transformer.spec.ts`
 * - `transformer` test
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/codes-backend-api/cores`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2 } from 'lemon-core';
import { $T, parsePaginateParam } from './commons';

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

//* main test body.
describe('commons', () => {
    it('should pass asLut', async () => {
        expect2(() => $T.asLut('some', $LUT.Languages, 'lang')).toEqual('.lang[some] is invalid key - asLut(lang)');
        expect2(() => $T.asLut('ko', $LUT.Languages, 'lang')).toEqual('ko');
        expect2(() => $T.asLut('en', $LUT.Languages, 'lang')).toEqual('en');
        expect2(() => $T.asLut('Korean', $LUT.Languages, 'lang')).toEqual('ko');
        expect2(() => $T.asLut(null, $LUT.Languages, 'lang')).toEqual(null);
        expect2(() => $T.asLut(null, $LUT.Languages, { default: 'some' })).toEqual('some');
        expect2(() => $T.asLut(undefined, $LUT.Languages, 'lang')).toEqual(undefined);
        expect2(() => $T.asLut(undefined, $LUT.Languages, { default: 'some' })).toEqual(undefined);
        expect2(() => $T.asLut('', $LUT.Languages, 'lang')).toEqual('');
    });

    it('should pass parsePaginateParam', async () => {
        expect2(() => parsePaginateParam()).toEqual({ limit: 10, page: 0 });
        expect2(() => parsePaginateParam({ limit: 0 })).toEqual({ limit: 0, page: 0 });
        expect2(() => parsePaginateParam({ limit: -1 })).toEqual({ limit: 2000, page: 0 });
        expect2(() => parsePaginateParam({ limit: -1 }, { noLimit: true })).toEqual({ limit: 2000, page: 0 });
        expect2(() => parsePaginateParam({ limit: 1 }, { noLimit: true })).toEqual({ limit: 2000, page: 0 });
        expect2(() => parsePaginateParam({ limit: -1 }, { noLimit: false })).toEqual({ limit: -1, page: 0 });
        expect2(() => parsePaginateParam({ limit: 1 }, { noLimit: false })).toEqual({ limit: 1, page: 0 });

        expect2(() => parsePaginateParam({ page: -1 })).toEqual({ limit: 10, page: -1 });
        expect2(() => parsePaginateParam({ page: 1, sort: 'a' })).toEqual({ limit: 10, page: 1, sort: 'a' });
        expect2(() => parsePaginateParam({ offset: '2' } as any)).toEqual({ limit: 10, page: 0, offset: 2 });
        expect2(() => parsePaginateParam({ offset: '2' } as any, { limit: 4 })).toEqual({
            limit: 4,
            page: 0,
            offset: 2,
        });
    });
});
