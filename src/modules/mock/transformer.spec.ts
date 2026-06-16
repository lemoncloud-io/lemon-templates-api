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
import { _it, describe, it, expect2, expect, GETERR } from '../../cores/commons.spec';
import { AbstractTransformer } from 'lemon-core';
import { $FIELD, Model, MockModel, filterFields, TestModel } from './model';
import { $Y, $trans } from './transformer';
import { fieldKeys } from '../../generated/field-registry';
import { onlyDefined } from '../../cores';

const $mock = filterFields(fieldKeys.mockTransformerModel<Model>(), ['meta']);

//! main test body.
describe('transformer', () => {
    /** 모델별 추가 필드목록만 추림 */
    const notInModel = (fields: string[], must = ['id']) => fields.filter(s => must.includes(s) || !$mock.includes(s));
    /** 모델 샘픔이 모든 추가 필드를 가지고 있는 확인하기 위해서 */

    const checkAllKeys = <T extends Model>(model: T, fields: string[]) => {
        //* 최소한, 만일 `keys()`가 잘 작동했다면, 공통 필드를 가지고 있어야함.
        const commons = fields.reduce<string[]>((L, a) => {
            if ($mock.includes(a)) L.push(a);
            return L;
        }, []);
        expect2(() => $mock?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(
            'id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt',
        );
        expect2(() => commons?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(
            'id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt',
        );
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
            stereo: $model.stereo,
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

    //* test of `test-model`
    it('should pass test-model', async () => {
        const FIELD = $FIELD.test;
        const trans = $trans.test;
        const $model: TestModel = {
            id: 'id',
            name: '방법',
            stereo: '#',
            count: 1,
            extra: {},
            mockId: 'mock-1',
            mock$: { id: 'mock-1', name: 'Mock', stereo: '#' },
            mockIds: ['mock-1', 'mock-2'],
            mock$$: [
                { id: 'mock-1', name: 'Mock', stereo: '#' },
                { id: 'mock-2', name: 'Mock 2', stereo: '#alias' },
            ],
            $mock: { id: 'mock-1', name: 'Mock', stereo: '#' },
            $mocks: [{ id: 'mock-1', name: 'Mock', stereo: '#' }],
        };

        //* immutable.
        const $imune: TestModel = {
            // id: undefined,
            stereo: undefined,
            extra: undefined,
            mock$: undefined,
            mock$$: undefined,
            $mock: undefined,
            $mocks: undefined,
        };

        expect2(() => trans.asHead($model)).toEqual({
            id: $model.id,
            name: $model.name,
            stereo: $model.stereo,
        });

        expect2(() => checkAllKeys($model, FIELD)).toEqual(['_idx']);
        expect2(() => trans.modelAsView($model), 'required,mockId,mock$,mockIds,mock$$').toEqual({
            require: undefined,
            mockId: 'mock-1',
            mock$: $trans.mock.modelAsView($model.mock$),
            mockIds: ['mock-1', 'mock-2'],
            mock$$: $model.mock$$.map(N => $trans.mock.modelAsView(N)),
        });

        // check of immutable fields (stereo)
        expect2(() => trans.bodyToModel(onlyDefined(trans.modelAsView($model)))).toEqual({
            ...$model,
            ...$imune,
        });
        // check of initial creation.
        expect2(() => trans.bodyToModel(trans.modelAsView($model), true)).toEqual({
            ...$model,
            ...$imune,
            stereo: $model?.stereo,
        });
    });

    //* golden sample contract: `TestModel` reference fields.
    it('should keep test-model golden reference contract', async () => {
        const FIELD = $FIELD.test;
        const trans = $trans.test;
        const $model: TestModel = {
            id: 'test-1',
            name: 'Test',
            stereo: '#',
            mockId: 'mock-1',
            mock$: { id: 'mock-1', name: 'Mock', stereo: '#' },
            mockIds: ['mock-1'],
            mock$$: [{ id: 'mock-1', name: 'Mock', stereo: '#' }],
            $mock: { id: 'mock-1', name: 'Mock', stereo: '#' },
            $mocks: [{ id: 'mock-1', name: 'Mock', stereo: '#' }],
        };

        expect2(() => FIELD.filter(N => N.startsWith('mock'))).toEqual(['mockId', 'mock$', 'mockIds', 'mock$$']);
        expect2(() => trans.modelAsView($model), 'mockId,mock$,mockIds,mock$$').toEqual({
            mockId: 'mock-1',
            mock$: $trans.mock.modelAsView($model.mock$),
            mockIds: ['mock-1'],
            mock$$: [$trans.mock.modelAsView($model.mock$$[0])],
        });
        expect2(() => trans.bodyToModel(onlyDefined(trans.modelAsView($model)))).toEqual({
            id: 'test-1',
            name: 'Test',
            mockId: 'mock-1',
            mockIds: ['mock-1'],
        });
    });
});
