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
import { _it, expect2, NextIdentityAccess, $info } from 'lemon-core';

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
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE =', PROFILE);

    //! basic function
    it('should pass basic function', async () => {
        const { service, proxy, current } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
    });

    //* test of content-manager
    it('should pass socket-manager(session)', async () => {
        const { service, proxy, current, _ts } = instance('session');
        const $cont = proxy.socket;

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        expect2(() => $cont.$mgr.hello()).toEqual(
            'typed-storage-service:socket/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
    });
});
