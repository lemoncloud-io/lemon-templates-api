/**
 * `transformer.spec.ts`
 * - `transformer` test
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { AbstractTransformer, expect2 } from 'lemon-core';
import { $FIELD, Model, filterFields, CallbackModel } from './model';
import { $trans } from './transformer';
import { keys } from 'ts-transformer-keys';
const $temp = filterFields(keys<Model>(), ['meta']);

//1 main test body.
describe('transformer', () => {
    /** 모델별 추가 필드목록만 추림 */
    const notInModel = (fields: string[], must = ['id']) => fields.filter(s => must.includes(s) || !$temp.includes(s));

    /** 모델 샘픔이 모든 추가 필드를 가지고 있는 확인하기 위해서 */
    const checkAllKeys = <T extends Model>(model: T, fields: string[]) => {
        const keys = Object.keys(model);
        const alls = notInModel(fields);
        //* model 정의에 포함안된 항목찾기 (필드 추가시 에러 발생하도록)
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

    it('should pass basic function', async () => {});

    //* test for each transformer w/ default instance.
    it('should pass callback transformer', async () => {
        const FIELD = $FIELD.callback;
        const trans = $trans.callback;
        const $model: CallbackModel = {
            id: 'A',
            stereo: '',
            name: '아파트',
            hidden: 0,
            optional: 1,
        };
        const $imune: CallbackModel = {
            // id: undefined,
            stereo: undefined,
            // name: undefined,
        };
        expect2(() => checkAllKeys($model, FIELD)).toEqual([]);
        expect2(() => trans.modelAsView($model), 'hidden,optional').toEqual({
            hidden: false,
            optional: true,
        });

        expect2(() => trans.asHead($model)).toEqual({
            id: $model.id,
            name: $model.name,
            stereo: $model.stereo,
        });

        // check ONLY in view
        expect2(() => viewOnly(trans, $model), '').toEqual({
            // stereo: $model.stereo,
        });

        //* loop transform
        expect2(() => trans.bodyToModel(trans.modelAsView($model), true)).toEqual({
            ...$model,
            ...$imune,
            stereo: $model.stereo,
        });
        expect2(() => trans.bodyToModel(trans.modelAsView($model), false)).toEqual({
            ...$model,
            ...$imune,
        });
    });
});
