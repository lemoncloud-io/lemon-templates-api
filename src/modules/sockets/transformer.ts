/**
 * `transformer.ts`
 * - transformer view to model
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @author      Aiden <aiden@lemocloud.io>
 * @date        2025-07-23 refactored for sockets service
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { AbstractTransformer } from 'lemon-core';
import { $T } from '../../cores/commons';
import { $HEAD, ChannelHead, ChannelModel, ConnectionModel, SocketModel } from './model';
import $LUT, { ChannelBody, ChannelView, ConnectionBody, ConnectionView, SocketBody, SocketView } from './views';

/**
 * class: `SocketTransformer`
 */
export class SocketTransformer extends AbstractTransformer<SocketModel, SocketView, SocketBody> {
    /**
     * @override
     */
    public modelAsView(model: SocketModel, hasCores?: boolean): SocketView {
        const view = super.modelAsView(model, hasCores);
        return this.onlyDefined<SocketView>({
            ...view,
            name: model.name,
        });
    }
    /**
     * @override
     */
    public bodyToModel(body: SocketBody, isCreate?: boolean): SocketModel {
        const model = super.bodyToModel(body, isCreate);
        if (!model) return model;

        if (body?.name !== undefined) model.name = $T.S2(body.name);

        return model;
    }
}

/**
 * class: `ConnectionTransformer`
 */
export class ConnectionTransformer extends AbstractTransformer<ConnectionModel, ConnectionView, ConnectionBody> {
    /**
     * @override
     */
    public modelAsView(model: ConnectionModel, hasCores?: boolean): ConnectionView {
        const view = super.modelAsView(model, hasCores);
        return this.onlyDefined<ConnectionView>({
            ...view,
            stereo: model.stereo,
            stage: model.stage,
            domain: model.domain,
            connectionId: model.connectionId,

            connectedAt: model.connectedAt,
            disConnectedAt: model.disConnectedAt,

            origin: model.origin,
            remote: model.remote,
            agent: model.agent,
            reason: model.reason,
            disconnectCode: model.disconnectCode,
            channels: model.channels,
            channel$$: model?.channel$$ ? model.channel$$.map(c => $trans.channel.asHead(c)) : undefined,
        });
    }
    /**
     * @override
     */
    public bodyToModel(body: ConnectionBody, isCreate?: boolean): ConnectionModel {
        const model = super.bodyToModel(body, isCreate);
        if (!model) return model;

        return model;
    }
}

/**
 * class: `ChannelTransformer`
 */
export class ChannelTransformer extends AbstractTransformer<ChannelModel, ChannelView, ChannelBody> {
    /**
     * @override
     */
    public modelAsView(model: ChannelModel, hasCores?: boolean): ChannelView {
        const view = super.modelAsView(model, hasCores);
        return this.onlyDefined<ChannelView>({
            ...view,
            stereo: model.stereo,
            service: model.service,
            modelType: model.modelType,
            desc: model.desc,
            subscribed: model.subscribed,

            aliasId: model.aliasId,
            alias$: model.alias$ !== undefined ? this.modelAsView(model.alias$, hasCores) : undefined,
            $alias: model?.$alias ? this.modelAsView(model.$alias, hasCores) : undefined,
        });
    }
    /**
     * @override
     */
    public bodyToModel(body: ChannelBody, isCreate?: boolean): ChannelModel {
        const model = super.bodyToModel(body, isCreate);
        if (!model) return model;

        if (isCreate) {
            if (body?.stereo !== undefined) model.stereo = $T.asLut(body.stereo, $LUT.ChannelStereo, 'stereo');
            if (body?.service !== undefined) model.service = $T.S2(body.service);
            if (body?.modelType !== undefined) model.modelType = $T.S2(body.modelType);
        }
        if (body?.desc !== undefined) model.desc = $T.S(body.desc);

        return model;
    }

    /**
     * extract only for head
     */
    public asHead = (model: ChannelModel): ChannelHead =>
        !model
            ? null
            : $HEAD.channel.reduce<ChannelHead>((M, key) => {
                  const val = model && model[key as keyof ChannelModel];
                  if (val !== undefined) (M as any)[key] = val;
                  return M;
              }, {} as any);
}

/**
 * defualt export w/ instance
 */
export const $trans = {
    socket: new SocketTransformer(),
    conns: new ConnectionTransformer(),
    channel: new ChannelTransformer(),
};
