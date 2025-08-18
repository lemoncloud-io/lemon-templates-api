/**
 * `socket/transformer.spec.ts`
 * - `transformer` test
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @author      Aiden <aiden@lemoncloud.io>
 * @date        2025-08-18 implemented socket service.
 * @copyright   (C) lemoncloud.io 2025 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { AbstractTransformer, expect2 } from 'lemon-core';
import { $FIELD, Model, filterFields, ConnectionModel, ChannelModel } from './model';
import { $trans } from './transformer';
import { keys } from 'ts-transformer-keys';
import { $T } from '../../cores';

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

    const viewOnly = <T extends AbstractTransformer<any, any, any>>(trans: T, $model: any) => {
        const V = trans.modelAsView($model);
        const M = trans.bodyToModel(V, true);
        return Object.entries(V).reduce((R, [k, v]) => {
            if ((M as any)[k] === undefined) (R as any)[k] = v;
            return R;
        }, {});
    };

    //* test of `connection-model`
    it('should pass connection-model', async () => {
        const FIELD = $FIELD.connection;
        const trans = $trans.conns;
        const $model: ConnectionModel = {
            id: '1000001',
            stereo: '',
            stage: 'stage',
            domain: 'domain',
            connectionId: 'connectionId',
            connectedAt: 2,
            disConnectedAt: 4,
            disconnectCode: 5,
            origin: 'origin',
            remote: 'remote',
            agent: 'agent',
            reason: 'reason',
            channels: ['A'],
            channel$$: [{ id: 'A' }],
        };
        //* immutable.
        const $imune: ConnectionModel = {
            stereo: undefined, //* immutable
            stage: undefined, //* immutable
            domain: undefined, //* immutable
            connectionId: undefined, //* immutable
            connectedAt: undefined, //* immutable
            disConnectedAt: undefined, //* immutable
            origin: undefined, //* immutable
            remote: undefined, //* immutable
            agent: undefined, //* immutable
            reason: undefined, //* immutable
            disconnectCode: undefined, //* immutable
            channels: undefined, //* immutable
            channel$$: undefined, //* immutable
        };

        expect2(() => checkAllKeys($model, FIELD)).toEqual([]);
        expect2(() => trans.modelAsView($model), 'required').toEqual({});

        // check ONLY in view
        expect2(() => viewOnly(trans, $model)).toEqual({
            stereo: $model.stereo,
            stage: $model.stage,
            domain: $model.domain,
            connectionId: $model.connectionId,
            connectedAt: $model.connectedAt,
            disConnectedAt: $model.disConnectedAt,
            origin: $model.origin,
            remote: $model.remote,
            agent: $model.agent,
            reason: $model.reason,
            disconnectCode: $model.disconnectCode,
            channels: $model.channels,
            channel$$: $model.channel$$,
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

    //* test of `channel-model`
    it('should pass channel-model', async () => {
        const FIELD = $FIELD.channel;
        const trans = $trans.channel;
        const $model: ChannelModel = {
            id: '1000001',
            stereo: '',
            service: 'service',
            modelType: 'modelType',
            aliasId: 'aliasId',
            alias$: {},
            channel: 'channel',
            desc: 'desc',
            subscribed: 1,
        };
        //* immutable.
        const $imune: ChannelModel = {
            stereo: undefined, //* immutable
            aliasId: undefined, //* immutable.
            alias$: undefined, //* immutable.
            service: undefined, //* immutable
            modelType: undefined, //* immutable
            channel: undefined, //* immutable
            subscribed: undefined, //* immutable
        };

        expect2(() => checkAllKeys($model, FIELD)).toEqual([]);
        expect2(() => trans.modelAsView($model), 'required').toEqual({});

        expect2(() => trans.asHead($model)).toEqual({
            id: $model.id,
            service: $model.service,
            modelType: $model.modelType,
        });

        // check ONLY in view
        expect2(() => viewOnly(trans, $model)).toEqual({
            aliasId: $model.aliasId,
            alias$: $model.alias$,
            subscribed: $model.subscribed,
        });

        // check in loop
        expect2(() => trans.bodyToModel(trans.modelAsView($model))).toEqual({
            ...$model,
            ...$imune,
        });
        expect2(() => trans.bodyToModel(trans.modelAsView($model), true)).toEqual({
            ...$model,
            ...$imune,
            stereo: $model.stereo,
            service: $model.service,
            modelType: $model.modelType,
        });
    });
});
