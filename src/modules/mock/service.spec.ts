/**
 * `service.spec.ts`
 * - unit test for `tickets-proxy` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2022-02-24 initial skeleton.
 * @date        2022-03-04 refactoring for activity service.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
import { loadProfile } from 'lemon-core/dist/environ';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _it, describe, it, expect2, expect, GETERR } from '../../cores/commons.spec';
import { NextIdentityAccess, $info } from 'lemon-core';

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
        const { service, proxy, current, context } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        const expFields = [
            'name',
            'stereo',
            'count',
            'extra',
            'mockId',
            'mock$',
            'mockIds',
            'mock$$',
            'ns',
            'type',
            'sid',
            'uid',
            'gid',
            'lock',
            'next',
            'meta',
            'createdAt',
            'updatedAt',
            'deletedAt',
            'error',
            'id',
            '_idx',
        ];
        expect2(() => service.$test.FIELDS).toEqual(expFields);
        expect2(() => service.$test.type).toEqual('test');
        expect2(await service.guardProxy(context, async proxy => proxy.test.$mgr.FIELDS)).toEqual(expFields);
    });

    //* test of test-manager
    it('should pass test-manager', async () => {
        const { proxy, current } = instance();

        expect2(await proxy.test.loadMeta('0')).toEqual(null);
        expect2(await proxy.test.saveMeta('0', { a: 1 })).toEqual({ a: 1 });
        expect2(await proxy.test.saveMeta('0', { b: 2 })).toEqual({ a: 1, b: 2 });
        expect2(await proxy.test.saveMeta('0', { a: undefined })).toEqual({ b: 2 });
        expect2(await proxy.test.loadMeta('0')).toEqual({ b: 2 });
        expect2(await proxy.test.get('0')).toEqual({
            ns: 'TT',
            type: 'test',
            stereo: '#meta',
            id: '0',
            meta: '{"b":2}',
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

        expect2(await proxy.test.set('0', { meta: '{xx' }), 'id').toEqual({ id: '0' });
        expect2(await proxy.test.loadMeta('0')).toEqual({ _: '{xx' });

        expect2(await proxy.test.set('0', { meta: 'xx' }), 'id').toEqual({ id: '0' });
        expect2(await proxy.test.loadMeta('0')).toEqual({ _: 'xx' });
    });
});
