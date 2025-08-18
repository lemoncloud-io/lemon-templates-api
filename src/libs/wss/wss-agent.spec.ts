/**
 * `wss.spec.ts`
 * - test spec for `wss`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-06-30 initial version
 * @author      Aiden <aiden@lemoncloud.io>
 * @date        2025-07-31 refactored for WebSocket support
 *
 * @copyright   (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-cluster-api/cluster`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect2, _it, NextContext, NextIdentity, $U, WSSEvent } from 'lemon-core';
import { LambdaWSSHandler, WSSAgentRunner } from './wss-agent';
import * as $proxy from '../../service/backend-service.spec';
import { AuthType } from '../../service/backend-service.spec';
import * as $tools from './tools.spec';
import { SocketEvent, SocketEventType } from './wss-types';

//* create service instance.
export const instance = (type: AuthType = 'authed') => {
    const { service, current } = $proxy.instance(type);
    const $tool = $tools.instance();
    const event = $tool.event;
    const agent = new (class extends LambdaWSSHandler {
        public constructor() {
            super(service, new MyDummyWSSAgentRunner());
        }
        public hello = () => `dummy-wss-handler:${this.service.hello()}`;
    })();
    return { event, agent, $tool };
};

/**
 * class: `MyDummyWSSAgentRunner`
 * - customized dummy runner to service mocks data.
 */
class MyDummyWSSAgentRunner implements WSSAgentRunner {
    onSocketEvent(event: SocketEvent, context: NextContext<NextIdentity<any>>): Promise<any> {
        const errScope = `onSocketEvent(${event?.direction ?? '-'}/${event?.id ?? ''})`;
        if (!event) throw new Error(`@event is required - ${errScope}`);
        if (!event?.id) throw new Error(`@event.id (string) is required - ${errScope}`);
        const _run = async (type: SocketEventType | string) => {
            if (!type) {
                throw new Error(`@type (string) is required - ${errScope}`);
            } else if (type == 'echo' || type == 'ECHO') {
                return 'echo';
            } else if (type == 'CONNECT') {
                return 'connect';
            } else if (type == 'DISCONNECT') {
                return 'disconnect';
            } else if (type == 'MESSAGE') {
                return 'message';
            } else {
                throw new Error(`@type[${type}] is invalid! - ${errScope}`);
            }
        };
        //* return must be void (200);
        return _run(event?.type);
    }
}

//* main test body.
describe('WSSAgent', () => {
    //* check `$base64`.
    it('should pass basic function', async () => {
        const { agent } = instance();
        expect2(() => agent.hello()).toEqual('dummy-wss-handler:backend-service:TT/dummy-data.yml');
    });

    //* pass tools()
    it('should pass header tools', async () => {
        const { agent, $tool } = instance();

        //* 1. load a sample
        const event = $tool.ld('wss-con-event.json')?.event;

        //* 2. test with event
        expect2(await agent.packContext()).toEqual(null);
        expect2(await agent.packContext(null)).toEqual(null);
        expect2(await agent.packContext(event)).toEqual({
            accountId: '',
            userAgent: '',
            clientIp: '221.149.250.13',
            domain: 'qksfa5jxm1.execute-api.ap-northeast-2.amazonaws.com',
            requestId: 'OjXY6FCWoE0Ee_Q=',
            identity: {},
        });
        event.headers['x-lemon-identity'] = '1234';
        expect2(await agent.packContext(event), 'identity').toEqual({ identity: { meta: '1234' } });

        //* 3. test with identity
        const identity: NextIdentity = { sid: 'S1001', uid: 'U', gid: 'g', roles: ['user'] };
        const current = $U.dt('2025-08-18 11:22:33').getTime();
        const expToken =
            'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiJTMTAwMSIsInVpZCI6IlUiLCJnaWQiOiJnIiwicm9sZXMiOlsidXNlciJdLCJpc3MiOm51bGwsImlhdCI6MTc1NTQ4Mzc1MywiZXhwIjoxNzU1NTcwMTUzfQ.';
        expect2(() => current).toEqual(1755483753000);

        const _jwt = async (event: WSSEvent, identity: NextIdentity, alias?: string) =>
            agent.tools(event).encodeIdentityJWT(identity, { current, alias });

        expect2(await _jwt(event, identity), 'token').toEqual({
            token: `${expToken}`,
        });
        expect2(() => $U.jwt().decode(`${expToken}`)).toEqual({
            iss: null,
            exp: 1755570153,
            iat: 1755483753,
            ...identity,
        });

        // * 4. test with identity header
        event.headers['x-lemon-identity'] = expToken;
        expect2(await agent.packContext(event), 'identity').toEqual({
            identity: {
                error: '@iss[null] is invalid (unsupportable issuer) - verifyJWT(http)',
                meta: expToken,
            },
        });

        // * 5. test with alias
        const alias = 'lemon-identity-key';
        const $enc = await _jwt(event, identity, alias);
        expect2(() => $U.jwt().decode($enc.token)).toEqual({
            iss: `kms/${alias}`,
            exp: 1755570153,
            iat: 1755483753,
            ...identity,
        });

        event.headers['x-lemon-identity'] = $enc.token;
        expect2(await agent.packContext(event), 'identity').toEqual({
            identity: {
                iss: `kms/${alias}`,
                exp: 1755570153,
                iat: 1755483753,
                ...identity,
            },
        });
    });
});
