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
import { AbstractTransformer, expect2 } from 'lemon-core';
import { $FIELD, Model, MockModel, filterFields, TestModel } from './model';
import { $Y, $trans } from './transformer';
import { fieldKeys } from '../../generated/field-registry';

const $mock = filterFields(fieldKeys.mockTransformerModel<Model>(), ['meta']);

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

    const viewOnly = <T extends AbstractTransformer<any, any, any>>(trans: T, $model: any) => {
        const V = trans.modelAsView($model);
        const M = trans.bodyToModel(V, true);
        return Object.entries(V).reduce((R, [k, v]) => {
            if ((M as any)[k] === undefined) (R as any)[k] = v;
            return R;
        }, {});
    };

    it('should pass basic function', async () => {
        expect2(() => $Y.phone.asModel('')).toEqual('@phone[] is invalid format - phone.asModel()');
    });

    //* test of `mock-model`
    it('should pass mock-model', async () => {
        const FIELD = $FIELD.mock;
        const trans = $trans.mock;
        const $model: MockModel = {
            id: '1000001',
            stereo: '#',
            name: 'name',
            aliasId: 'aliasId',
            // parentId: 'parentId',
            // parent$: {},
        };
        //* immutable.
        const $imune: MockModel = {
            // stereo: undefined, //* immutable
            aliasId: undefined, //* immutable.
            // parent$: undefined, //* immutable.
        };

        expect2(() => checkAllKeys($model, FIELD)).toEqual([]);
        expect2(() => trans.modelAsView($model), 'required').toEqual({});

        expect2(() => trans.asHead($model)).toEqual({
            id: $model.id,
            name: $model.name,
        });

        // check ONLY in view
        expect2(() => viewOnly(trans, $model), '!parent$').toEqual({
            // parent$: $model.parent$,
            aliasId: $model.aliasId,
        });

        // check in loop
        expect2(() => trans.bodyToModel(trans.modelAsView($model))).toEqual({
            ...$model,
            ...$imune,
        });
        expect2(() => trans.bodyToModel(trans.modelAsView($model), true)).toEqual({
            ...$model,
            ...$imune,
        });
    });

    //! test for each transformer w/ default instance.
    it('should pass test transformer', async () => {
        const FIELD = $FIELD.test;
        const trans = $trans.test;
        const $model: TestModel = {
            id: 'id',
            name: '방법',
            count: 1,
            extra: {},
        };
        expect2(() => checkAllKeys($model, FIELD)).toEqual(['_idx', '_date']);
        expect2(() => trans.modelAsView($model), 'required').toEqual({});
        expect2(() => trans.bodyToModel(trans.modelAsView($model))).toEqual({
            ...$model,
            stereo: undefined, //* immutable.
            extra: undefined, //* immutable.
        });
        expect2(() => trans.bodyToModel(trans.modelAsView($model), true)).toEqual({
            ...$model,
            stereo: $model.stereo,
            extra: undefined, //* immutable.
        });
    });
});
