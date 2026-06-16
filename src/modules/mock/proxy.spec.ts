/**
 * `proxy.spec.ts`
 * - unit test for `tickets-proxy` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2022-02-24 initial skeleton.
 * @date        2022-03-04 refactoring for activity service.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _it, describe, it, expect2, expect, GETERR } from '../../cores/commons.spec';
import { NextIdentityAccess, $info } from 'lemon-core';
import { MockModel, TestModel } from './model';

import { BackendProxy } from '../../service/backend-proxy';
import * as $service from '../../service/backend-service.spec';

/**
 * make service and proxy
 */
export const instance = (type: $service.AuthType = 'authed', params?: $service.ServiceParams) => {
    const { service, current, context, data, _ts } = $service.instance(type, params);
    const proxy = new (class extends BackendProxy {
        public constructor() {
            super(context, service);
        }
        protected async fetchIdentityAccess(identityId: string) {
            if (!identityId) throw new Error(`.identityId is required - fetchAccess()`);
            const $identity = data?.Access as NextIdentityAccess;
            return { identityId, $identity };
        }
    })();
    return { service, current, proxy, context, _ts, $info: $info() };
};

//! main test body.
describe('BackendProxy', () => {
    //! basic function
    it('should pass basic function', async () => {
        const { service, proxy, current } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
    });

    //* test of mock-manager
    it('should pass mock-manager', async () => {
        const { service, proxy, current, _ts } = instance();
        const $prx = proxy.mock;

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        expect2(() => $prx.$mgr.hello()).toEqual(
            'typed-storage-service:mock/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        const model: MockModel = {
            id: 'A',
            name: 'service A',
        };

        expect2(await $prx.validateModel({}).catch(GETERR)).toEqual(
            `.name (string) is required - validate(${$prx.$mgr.type}/)`,
        );
        expect2(await $prx.validateModel({ ...model, catalogId: undefined }).catch(GETERR)).toEqual({
            ...model,
        });

        //* validate update linked models
        const $new = await $prx.makeModel<MockModel>({ ...model });
        expect2(() => $new).toEqual({
            ..._ts(model.id, { type: $prx.$mgr.type }),
            name: model.name,
        });
    });

    //* test of test-manager reference heads
    it('should update test.mock$ and test.mock$$ when mock ids are changed', async () => {
        const { proxy, _ts } = instance();

        const mockA = await proxy.mock.makeModel<MockModel>({ id: 'mock-A', name: 'Mock A', stereo: '#' });
        const mockB = await proxy.mock.makeModel<MockModel>({ id: 'mock-B', name: 'Mock B', stereo: '#alias' });

        const test = await proxy.test.makeModel<TestModel>({
            id: 'test-A',
            name: 'Test A',
            mockId: mockA.id,
            mockIds: [mockA.id, mockB.id],
        });

        expect2(() => test, 'mockId,mock$,mockIds,mock$$').toEqual({
            mockId: 'mock-A',
            mock$: { id: 'mock-A', name: 'Mock A', stereo: '#' },
            mockIds: ['mock-A', 'mock-B'],
            mock$$: [
                { id: 'mock-A', name: 'Mock A', stereo: '#' },
                { id: 'mock-B', name: 'Mock B', stereo: '#alias' },
            ],
        });

        expect2(() => test, 'id,name,type').toEqual({
            id: 'test-A',
            name: 'Test A',
            type: 'test',
        });
    });
});
