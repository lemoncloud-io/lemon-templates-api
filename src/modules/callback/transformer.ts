/**
 * `transformer.ts`
 * - transformer view to model
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
import { AbstractTransformer } from 'lemon-core';
import { $T } from '../../cores/commons';
import { $HEAD, CallbackHead, CallbackModel } from './model';
import $LUT, { CallbackBody, CallbackView } from './views';

/**
 * class: `CallbackTransformer`
 */
export class CallbackTransformer extends AbstractTransformer<CallbackModel, CallbackView, CallbackBody> {
    /**
     * @override
     */
    public modelAsView(model: CallbackModel, hasCores?: boolean): CallbackView {
        const view = super.modelAsView(model, hasCores);
        return this.onlyDefined({
            ...view,
            stereo: model?.stereo,
            name: model?.name,
            hidden: model?.hidden !== undefined ? $T.B(model.hidden) : undefined,
            optional: model?.optional !== undefined ? $T.B(model.optional) : undefined,

            state: model?.state,
            parentId: model?.parentId,
            parent$: model?.parent$ ? this.modelAsView(model.parent$) : undefined,
            no: model?.no,
            target: model?.target,
            qid: model?.qid,
            handler: model?.handler,
            result: model?.result,

            $request: model?.$request,
            requestedAt: model?.requestedAt,
            responsedAt: model?.responsedAt,

            domain: model?.domain,
            clientIp: model?.clientIp,
            userAgent: model?.userAgent,
        });
    }

    /**
     * @override
     */
    public bodyToModel(body: CallbackBody, isCreate?: boolean): CallbackModel {
        const model = super.bodyToModel(body, isCreate);
        if (!model) return model;

        if (isCreate && body?.stereo !== undefined)
            model.stereo = $T.asLut(body?.stereo, $LUT.CallbackStereo, 'stereo');

        if (body?.name !== undefined) model.name = $T.S2(body.name);
        if (body?.optional !== undefined) model.optional = $T.BN(body.optional);
        if (body?.hidden !== undefined) model.hidden = $T.BN(body.hidden);

        return model;
    }

    /**
     * extract only for head
     */
    public asHead = (model: CallbackModel): CallbackHead =>
        !model
            ? null
            : $HEAD.callback.reduce<CallbackHead>((M, key) => {
                  const val = model && model[key as keyof CallbackModel];
                  if (val !== undefined) (M as any)[key] = val;
                  return M;
              }, {} as any);
}

/**
 * defualt export w/ instance
 */
export const $trans = {
    callback: new CallbackTransformer(),
};
