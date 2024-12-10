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
import { loadProfile } from 'lemon-core/dist/environ';
import { expect2, NextIdentityAccess, _it, $info, GETERR } from 'lemon-core';

import { BackendProxy } from '../../service/backend-proxy';
import * as $service from '../../service/backend-service.spec';
import { MockModel } from './model';

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
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE =', PROFILE);

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
        const $new = await $prx.makeModel({ ...model });
        expect2(() => $new).toEqual({
            ..._ts(model.id, { type: $prx.$mgr.type }),
            name: model.name,
        });
    });
});
