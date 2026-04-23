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
import { fieldKeys } from '../../generated/field-registry';

const $temp = filterFields(fieldKeys.callbackTransformerModel<Model>(), ['meta']);

//1 main test body.
describe('transformer', () => {
    /** 모델별 추가 필드목록만 추림 */
    const notInModel = (fields: string[], must = ['id']) => fields.filter(s => must.includes(s) || !$temp.includes(s));

    /** 모델 샘픔이 모든 추가 필드를 가지고 있는 확인하기 위해서 */
    const checkAllKeys = <T extends Model>(model: T, fields: string[]) => {
        //* 최소한, 만일 `keys()`가 잘 작동했다면, 공통 필드를 가지고 있어야함.
        const commons = fields.reduce<string[]>((L, a) => {
            if ($temp.includes(a)) L.push(a);
            return L;
        }, []);
        expect2(() => $temp?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(
            'id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt',
        );
        expect2(() => commons?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(
            'id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt',
        );

        //* model 정의에 포함안된 항목찾기 (필드 추가시 에러 발생하도록)
        const keys = Object.keys(model);
        const alls = notInModel(fields);
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
            state: 'requested',
            parentId: 'parentId',
            parent$: {},
            no: 1,
            target: 'target',
            qid: 'qid',
            handler: 'handler',
            result: 'result',

            domain: 'domain',
            clientIp: 'clientIp',
            userAgent: 'userAgent',

            $request: {},
            requestedAt: 0,
            responsedAt: 0,
        };
        const $imune: CallbackModel = {
            stereo: undefined,
            no: undefined,
            target: undefined,
            qid: undefined,
            handler: undefined,
            result: undefined,
            state: undefined,
            parentId: undefined,
            parent$: undefined,
            $request: undefined,
            requestedAt: undefined,
            responsedAt: undefined,
            domain: undefined,
            clientIp: undefined,
            userAgent: undefined,
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
            no: $model.no,
            target: $model.target,
            qid: $model.qid,
            handler: $model.handler,
            result: $model.result,
            state: $model.state,
            parentId: $model.parentId,
            parent$: $model.parent$,
            $request: $model.$request,
            requestedAt: $model.requestedAt,
            responsedAt: $model.responsedAt,
            domain: $model.domain,
            clientIp: $model.clientIp,
            userAgent: $model.userAgent,
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
