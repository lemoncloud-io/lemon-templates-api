/**
 * `tickets-proxy.spec.ts`
 * - unit test for `tickets-proxy` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2022-02-24 initial skeleton.
 * @date        2022-03-04 refactoring for activity service.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
import { expect2, NextIdentityAccess, _it } from 'lemon-core';
import { BackendProxy } from './backend-proxy';
import { AuthType, ServiceParams } from './backend-service.spec';
import * as $service from './backend-service.spec';
export { AuthType, ServiceParams };

/**
 * make service and proxy
 */
export const instance = (type: AuthType = 'authed', params?: ServiceParams) => {
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
    return { service, current, proxy, context, _ts };
};

//! main test body.
describe('BackendProxy', () => {
    //! basic function
    it('should pass basic function', async () => {
        const { service, proxy, current } = instance();

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        expect2(() => proxy.test.$mgr.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        expect2(() => proxy.test.$mgr.FIELDS.join(',')).toEqual(
            'name,count,extra,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id,_idx,_date',
        );

        expect2(() => proxy.asDate(null)).toEqual('@date[null] is invalid format!');
        expect2(() => proxy.asDate('')).toEqual('@date[] is invalid format!');
        expect2(() => proxy.asDate('2022-03-22')).toEqual('20220322');

        expect2(() => proxy.asIdOrIndex('2022-03-22')).toEqual('2022-03-22');
        expect2(() => proxy.asIdOrIndex(null as any)).toEqual(0);
        expect2(() => proxy.asIdOrIndex(undefined as any)).toEqual(0);
        expect2(() => proxy.asIdOrIndex('' as any)).toEqual(0);
        expect2(() => proxy.asIdOrIndex('0')).toEqual(0);
        expect2(() => proxy.asIdOrIndex('2')).toEqual(2);
        expect2(() => proxy.asIdOrIndex('11')).toEqual(11);
        expect2(() => proxy.asIdOrIndex('01')).toEqual('01');

        //! must pass of checking proxy w/ `_name`.
        const expectedS = {
            _id: 'TT:test:a',
            _idx: 2,
            _date: '11-22',
            id: 'a',
            ns: 'TT',
            type: 'test',
            createdAt: current,
            deletedAt: 0,
            updatedAt: current,
        };
        expect2(() => proxy.test.$mgr.FIELDS.filter(s => s.startsWith('_'))).toEqual(['_idx', '_date']);
        expect2(await proxy.test.$mgr.prepare('a', { _date: '11-22', _idx: 2 })).toEqual({
            ...expectedS,
        });
        expect2(await proxy.test.get('b', { _date: '11-22', _idx: 2 })).toEqual({
            ...expectedS,
            id: 'b',
            _id: undefined,
        });
    });
});
