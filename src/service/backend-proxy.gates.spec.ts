/**
 * `backend-proxy.gates.spec.ts`
 * - v5 pins of the internal-call receiver gates (HOW_TO_UPGRADE_V5 § 11.3):
 *   - `hasAdminRole()` is true in local mode, by the role claim, or for a v4 internal caller (`domain: 'localhost'`
 *     on `channel: 'internal'`); an external request never gets admin from `domain`.
 * - its own suite (no spec import), so each pin runs once.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-11-03 v5 B44 initial pins.
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, NextContext } from 'lemon-core';
import { BackendService } from './backend-service';
import { BackendProxy } from './backend-proxy';

//* the env names that decide `$U.isLocalMode()`.
const ENV_NAMES = ['LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME'];

//* a proxy on the dummy table w/ the given context.
const instance = (context: NextContext) => {
    const service = new BackendService('dummy-data.yml');
    const proxy = new BackendProxy(context, service);
    return { service, proxy };
};

//! main test body.
describe('BackendProxy (v5 B44 gates)', () => {
    const saved: { [key: string]: string } = {};

    //* keep the env values, then start each test as not local.
    beforeEach(() => {
        ENV_NAMES.forEach(name => (saved[name] = process.env[name]));
        delete process.env.LOCAL_MODE;
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    });

    //* restore the env values (unset stays unset).
    afterEach(() => {
        ENV_NAMES.forEach(name => {
            if (saved[name] === undefined) delete process.env[name];
            else process.env[name] = saved[name];
        });
    });

    //* (a) local mode: `LOCAL_MODE=1` w/o Lambda.
    it('local mode → hasAdminRole() true', async () => {
        process.env.LOCAL_MODE = '1';
        const { proxy } = instance({});
        expect2(() => proxy.hasAdminRole()).toEqual(true);
    });

    //* (b) an external request never gets admin from `domain`.
    it('not local, external w/ domain localhost → false', async () => {
        const { proxy } = instance({ domain: 'localhost', channel: 'external' } as NextContext);
        expect2(() => proxy.hasAdminRole()).toEqual(false);
    });

    //* (c) a v4 internal caller in transition.
    it('not local, internal w/ domain localhost → true', async () => {
        const { proxy } = instance({ domain: 'localhost', channel: 'internal' } as NextContext);
        expect2(() => proxy.hasAdminRole()).toEqual(true);
    });

    //* (d) the v5 role claim.
    it('not local, identity w/ roles [admin] → true', async () => {
        const { proxy } = instance({ identity: { sid: '', uid: '', roles: ['admin'] } } as NextContext);
        expect2(() => proxy.hasAdminRole()).toEqual(true);
    });

    //* D112: the internal delegation gate reads only `channel`.
    describe('isInternalCall()', () => {
        //* relay (protocol) or direct invoke.
        it('channel internal → true', async () => {
            const { proxy } = instance({ channel: 'internal' } as NextContext);
            expect2(() => proxy.isInternalCall()).toEqual(true);
        });

        //* local server.
        it('channel local → true', async () => {
            const { proxy } = instance({ channel: 'local' } as NextContext);
            expect2(() => proxy.isInternalCall()).toEqual(true);
        });

        //* an external web request, even w/ domain localhost.
        it('channel external → false', async () => {
            const { proxy } = instance({ domain: 'localhost', channel: 'external' } as NextContext);
            expect2(() => proxy.isInternalCall()).toEqual(false);
        });

        //* no channel at all.
        it('no channel → false', async () => {
            const { proxy } = instance({});
            expect2(() => proxy.isInternalCall()).toEqual(false);
        });

        //* the explicit context wins over `this.context`.
        it('explicit context overrides this.context', async () => {
            const { proxy } = instance({ channel: 'external' } as NextContext);
            expect2(() => proxy.isInternalCall({ channel: 'internal' } as NextContext)).toEqual(true);
            const { proxy: proxy2 } = instance({ channel: 'internal' } as NextContext);
            expect2(() => proxy2.isInternalCall({ channel: 'external' } as NextContext)).toEqual(false);
        });
    });
});
