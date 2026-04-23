/**
 * `service.spec.ts`
 * - unit test for `service` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
import { loadProfile } from 'lemon-core/dist/environ';
import { expect2, _it, $info } from 'lemon-core';

import { BackendProxy } from '../../service/backend-proxy';
import * as $service from '../../service/backend-service.spec';
import { filterFields, Model } from './model';
import { fieldKeys } from '../../generated/field-registry';

const $temp = filterFields(fieldKeys.callbackServiceModel<Model>(), ['meta']);

/**
 * make service and proxy
 */
export const instance = (type: $service.AuthType = 'authed', params?: $service.ServiceParams) => {
    const { service, current, context, data, _ts } = $service.instance(type, params);
    const proxy = new (class extends BackendProxy {
        public constructor() {
            super(context, service);
        }
    })();
    return { service, current, proxy, context, _ts, $info: $info() };
};

//! main test body.
describe('BackendProxy', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE =', PROFILE);

    /** 모델별 추가 필드목록만 추림 */
    const notInModel = (fields: string[], must = ['id']) => fields.filter(s => must.includes(s) || !$temp.includes(s));

    //* test of callback-model-manager
    it('should pass callback-model-manager', async () => {
        const { service, context } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        //* expected fields in designed model.
        const expFields = [
            'id',
            'name',
            'domain',
            'clientIp',
            'userAgent',
            'state',
            'parentId',
            'parent$',
            'no',
            'target',
            'qid',
            'handler',
            'result',
            // 'request$',
            'requestedAt',
            'responsedAt',
            'hidden',
            'optional',
        ];

        const $mgr = service.$callback;
        expect2(() => notInModel($mgr.FIELDS)).toEqual(expFields);
        expect2(() => $mgr.type).toEqual('callback');
        expect2(await service.guardProxy(context, async proxy => notInModel(proxy.callback.$mgr.FIELDS))).toEqual([
            ...expFields,
        ]);
    });
});
