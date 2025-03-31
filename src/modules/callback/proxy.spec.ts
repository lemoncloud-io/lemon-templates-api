/**
 * `proxy.spec.ts`
 * - unit test for `service` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
import { loadProfile } from 'lemon-core/dist/environ';
import { expect2, _it, GETERR, $info } from 'lemon-core';
import { CallbackModel, CallbackRequest } from './model';

import { BackendProxy } from '../../service/backend-proxy';
import * as $service from '../../service/backend-service.spec';
import { $trans } from './transformer';

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

    //* basic function
    it('should pass basic function', async () => {
        const { service } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
    });

    //* test of basic CallbackManagerProxy
    it('should pass basic CallbackManagerProxy', async () => {
        const { proxy, _ts } = instance();

        const $prx = proxy.callback;
        expect2(() => $prx.$mgr.hello()).toEqual(
            'typed-storage-service:callback/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );

        const model: CallbackModel = {
            stereo: '',
            name: 'parent',
        };
        expect2(await $prx.validateModel({ name: '#' }).catch(GETERR)).toEqual(
            `.name[#] is invalid - validateModel(callback/)`, // from manager.
        );
        expect2(await $prx.validateModel({ name: '!' }).catch(GETERR)).toEqual(
            `.name[!] is invalid - validate(callback/)`,
        );
        const $model = await $prx.makeModel({ ...model });
        expect2(() => $model).toEqual({
            ..._ts('1000001', 'callback'),
            stereo: '',
            name: model.name,
        });
        expect2(await $prx.validateModel({ name: '#' }, $model.id).catch(GETERR)).toEqual(
            `.name[#] is invalid - validate(callback/${$model.id})`, // from proxy
        );

        //* check of updateHead()
        expect2(await $prx.updateHead({ callbackId: $model.id })).toEqual({
            callbackId: '1000001',
            callback$: $prx.trans.asHead($model),
        });
        expect2(await $prx.updateHead({ callbackId: null })).toEqual({
            callbackId: null,
            callback$: undefined,
        });
        expect2(await $prx.updateHead({ callbackId: '' })).toEqual({
            callbackId: '',
            callback$: null,
        });
        expect2(await $prx.updateHead({ callbackId: 'xxxx' })).toEqual({
            callbackId: '',
            callback$: null,
        });
    });

    //* test of basic CallbackManagerProxy
    it('should pass basic CallbackManagerProxy.doRequest', async () => {
        const { proxy, _ts } = instance('authed');
        const $prxy = proxy.callback;

        const body: CallbackModel = {
            stereo: '',
            name: 'parent',
        };
        const model = await $prxy.makeModel(body);
        expect2(() => model).toEqual({
            ..._ts('1000001', 'callback'),
            stereo: '',
            name: body.name,
        });

        // expect2(await $prxy.doRequest(null, null).catch(GETERR)).toEqual(
        //     '@model.id (string) is required - doRequest(callback/)',
        // );
        // expect2(await $prxy.doRequest({}, null).catch(GETERR)).toEqual(
        //     '@model.id (string) is required - doRequest(callback/)',
        // );
        expect2(await $prxy.doRequest(null, null).catch(GETERR)).toEqual(
            '@request (object) is required - doRequest(-/-)',
        );

        const req: CallbackRequest = {
            service: 'lemon-hello-api',
            type: 'hello',
            id: 'echo',
            // cmd: 'cmd',
        };
        expect2(await $prxy.doRequest({}, { isSimul: true }).catch(GETERR)).toEqual(
            '@request.service (string) is required - doRequest(-/-)',
        );
        expect2(await $prxy.doRequest({ ...req }, { parent: model, isSimul: true }).catch(GETERR)).toEqual({
            ..._ts('1000001:1', 'callback'),
            stereo: '',
            name: 'parent',
            no: 1,
            parentId: '1000001',
            parent$: { id: '1000001', name: 'parent', stereo: '' },
            target: '//lemon-hello-api/hello/echo',
            request$: { ...req },
            error: '! in simulate mode - doRequest(lemon-hello-api/echo)',
        });
    });
});
