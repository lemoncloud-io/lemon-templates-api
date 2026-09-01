/**
 * `transformer.ts`
 * - transformer view to model
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { AbstractTransformer } from 'lemon-core';
import { $T } from 'lemon-core';
import { $HEAD, MockHead, MockModel, TestHead, TestModel } from './model';
import $LUT, { MockBody, MockView, TestBody, TestView } from './views';

/**
 * internal data transformer.
 */
export const $Y = {
    /** 전화번호 양식 체크 및 변환 */
    phone: {
        asView: (phone: string): string => {
            const RE = /(\d{3})(\d{4})(\d{4})/;
            return phone.replace(RE, '$1-$2-$3');
        },
        asModel: (phone: string, options?: { throwable?: boolean; errScope?: string }): string => {
            const throwable = options?.throwable ?? true;
            const errScope = options?.errScope ?? 'phone.asModel()';
            if (throwable) {
                const RE = /^\d{3}-?\d{4}-?\d{4}$/;
                if (!RE.test(phone) || !phone.startsWith('010'))
                    throw Error(`@phone[${phone}] is invalid format - ${errScope}`);
            }
            phone = phone.split('-').join('');
            return phone;
        },
    },
};

/**
 * class: `MockTransformer`
 */
export class MockTransformer extends AbstractTransformer<MockModel, MockView, MockBody> {
    /**
     * @override
     */
    public modelAsView(model: MockModel, hasCores?: boolean): MockView {
        const view = super.modelAsView(model, hasCores);
        return this.onlyDefined<MockView>({
            ...view,
            stereo: $T.nul2str(model.stereo),
            name: model.name,
            aliasId: model.aliasId,
            // parentId: model.parentId,
            // parent$: model.parent$ ? $trans.mock.modelAsView(model.parent$) : undefined,
        });
    }
    /**
     * @override
     */
    public bodyToModel(body: MockBody, isCreate?: boolean): MockModel {
        const model = super.bodyToModel(body, isCreate);
        if (!model) return model;

        if (body?.stereo !== undefined) model.stereo = $T.asLut(body?.stereo, $LUT.MockStereo, { name: 'stereo' });
        if (body?.name !== undefined) model.name = $T.S2(body.name);
        // if (body?.parentId !== undefined) model.parentId = $T.S2(body.parentId);

        return model;
    }

    /**
     * extract only for head
     */
    public asHead = (model: MockModel): MockHead =>
        !model
            ? null
            : $HEAD.mock.reduce<MockHead>((M, key) => {
                  const val = model && model[key as keyof MockModel];
                  if (val !== undefined) (M as any)[key] = val;
                  return M;
              }, {} as any);
}

/**
 * class: `TestTransformer`
 */
export class TestTransformer extends AbstractTransformer<TestModel, TestView, TestBody> {
    /**
     * @override
     */
    public modelAsView(model: TestModel, hasCores?: boolean): TestView {
        const view = super.modelAsView(model, hasCores);
        return this.onlyDefined({
            ...view,
            name: model.name,
            stereo: model.stereo,
            count: model.count,
            mockId: model.mockId,
            mock$: model.mock$ ? $trans.mock.modelAsView(model.mock$) : undefined,
            mockIds: model.mockIds,
            mock$$: model.mock$$ ? model.mock$$.map(N => $trans.mock.modelAsView(N)) : undefined,
            _idx: model._idx,
        });
    }
    /**
     * @override
     */
    public bodyToModel(body: TestBody, isCreate?: boolean): TestModel {
        const model = super.bodyToModel(body, isCreate);
        if (!model) return model;

        if (isCreate && body?.stereo !== undefined)
            model.stereo = $T.asLut(body?.stereo, $LUT.TestStereo, { name: 'stereo' });
        if (body?.name !== undefined) model.name = $T.S2(body.name);

        if (body?.count !== undefined) model.count = $T.N(body.count);
        if (body?.mockId !== undefined) model.mockId = $T.S2(body.mockId);
        if (body?.mockIds !== undefined) model.mockIds = $T.SS(body.mockIds).filter(Boolean);

        return model;
    }

    /**
     * extract only for head
     */
    public asHead = (model: TestModel): TestHead =>
        !model
            ? null
            : $HEAD.test.reduce<TestHead>((M, key) => {
                  const val = model && model[key as keyof TestModel];
                  if (val !== undefined) (M as any)[key] = val;
                  return M;
              }, {} as any);
}
/**
 * defualt export w/ instance
 */
export const $trans = {
    mock: new MockTransformer(),
    test: new TestTransformer(),
};
