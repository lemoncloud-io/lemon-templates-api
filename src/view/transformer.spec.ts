/**
 * `transformer.spec.ts`
 * - `transformer` test
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2 } from 'lemon-core';
import { Model, filterFields } from '../service/backend-model';
import { $X } from './transformer';
import { keys } from 'ts-transformer-keys';
import $LUT from '../service/backend-types';

const $mock = filterFields(keys<Model>(), ['meta']);

//! main test body.
describe('transformer', () => {
    /** 모델별 추가 필드목록만 추림 */
    const notInModel = (fields: string[], must = ['id']) => fields.filter(s => must.includes(s) || !$mock.includes(s));
    /** 모델 샘픔이 모든 추가 필드를 가지고 있는 확인하기 위해서 */

    const checkAllKeys = <T extends Model>(model: T, fields: string[]) => {
        const keys = Object.keys(model);
        const alls = notInModel(fields);
        //! model 정의에 포함안된 항목찾기 (필드 추가시 에러 발생하도록)
        return alls.filter(k => !keys.includes(k));
    };

    it('should pass asLut', async () => {
        expect2(() => $X.asLut(undefined, $LUT.Languages, { name: 'lang' })).toEqual(undefined);
        expect2(() => $X.asLut(null, $LUT.Languages, { name: 'lang' })).toEqual(null);
        expect2(() => $X.asLut(null, $LUT.Languages, { name: 'lang', default: 'X' })).toEqual('X');
        expect2(() => $X.asLut('some', $LUT.Languages, { name: 'lang' })).toEqual('.lang[some] is invalid!');
        expect2(() => $X.asLut('ko', $LUT.Languages, { name: 'lang' })).toEqual('ko');
    });
});
