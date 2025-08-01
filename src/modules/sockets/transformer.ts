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
import { SocketModel } from './model';
import { SocketBody, SocketView } from './views';

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
 * defualt export w/ instance
 */
export const $trans = {
    socket: new SocketTransformer(),
};
