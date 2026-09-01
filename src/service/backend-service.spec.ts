/**
 * `backend-service.spec.ts`
 * - test for `backend-service`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-03-04 refactoring for activity service.
 *
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR, $U, NextContext } from 'lemon-core';
import { BackendService } from './backend-service';
import { Model } from './backend-model';
import { onlyDefined } from 'lemon-core';
import { loadSample } from '../test-helpers/contexts.spec';

export type AuthType = 'authed' | 'public' | 'session';
export interface ServiceParams {
    /** the expected current timestamp */
    current?: number;
    /** flag of using dummy data (default true) */
    dummy?: boolean;
    /** overrided domain */
    domain?: string;
}

//! create service instance.
export const instance = (type: AuthType = 'authed', params?: ServiceParams) => {
    const current = params?.current ?? $U.current_time_ms();
    const isDummy = params?.dummy ?? true;
    const { context, data } = loadSample(type);
    if (params?.domain && context) (context as NextContext).domain = params?.domain;

    const service = new BackendService(isDummy ? 'dummy-data.yml' : '');
    service.setCurrent(current);

    const _ts = <T extends Model = Model>(id?: string, params?: T | string) =>
        onlyDefined({
            ns: service.NS,
            id,
            ...(typeof params === 'string' ? { type: params } : params),
            createdAt: current,
            updatedAt: current,
            deletedAt: 0,
        });

    return { service, current, context, data, _ts };
};

//! main test body.
describe('BackendService', () => {
    //! basic function
    it('should pass basic function', async () => {
        const { service, context } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        const ns = `${service.NS || ''}`;
        expect2(() => ({ ns })).toEqual({ ns: 'TT' });

        // NOTE: TestModel gained mockId/mock$/mockIds/mock$$ (linked-mock refs) and lost `_date`
        // in 73fadf2 ("chore: opt cores and mocks"); this expectation was never updated then.
        // field-registry.ts (regenerated via `fields:gen`, unchanged) confirms this is the current model shape.
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

    it('should pass making default model', async () => {
        const { service } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
    });

    it('guardProxy()', async () => {
        const { service, context, current } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');

        const ns = `${service.NS || ''}`;
        expect2(() => ({ ns })).toEqual({ ns: 'TT' });

        expect2(await service.$test.find('A00001')).toBeNull();

        // test get not exists model
        expect2(
            await service
                .guardProxy(context, async proxy => {
                    const model = await proxy.test.get('not_eixsts', true);
                    return model;
                })
                .catch(GETERR),
        ).toEqual('404 NOT FOUND - proxy/test/id:not_eixsts');

        // case 1. using guardProxy update model.name
        expect2(
            await service.guardProxy(context, async proxy => {
                const model = await proxy.test.get('A00001', {});
                model.name = 'hi test model';
                return 'anything';
            }),
        ).toEqual('anything');

        expect2(await service.$test.find('A00001')).toEqual({
            _id: 'TT:test:A00001',
            id: 'A00001',
            name: 'hi test model',
            ns: 'TT',
            type: 'test',
            createdAt: current,
            deletedAt: 0,
            updatedAt: current,
        });

        // case 2. get/set inside guardProxy
        await service.guardProxy(context, async proxy => {
            const model = await proxy.test.get('A00001', {});
            expect2(model.name).toEqual('hi test model');
            await proxy.test.set('A00001', { name: 'updated name' });

            const modelAfterSet = await proxy.test.get('A00001', {});
            expect2(() => modelAfterSet, 'name').toEqual({ name: 'updated name' });

            // must use only proxy variable for update
            // if you try real read, not applied update by proxy in guardProxy
            expect2((await service.$test.find('A00001')).name).not.toEqual('updated name');
        });
        // after await guardProxy you can use normal CRUD
        expect2(await service.$test.find('A00001')).toMatchObject({
            _id: 'TT:test:A00001',
            id: 'A00001',
            name: 'updated name',
        });
    });
});
