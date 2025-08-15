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
import { expect2, _it } from 'lemon-core';
import { $sockets } from './wss-agent';
import * as $tools from './tools.spec';

//* create service instance.
export const instance = (type?: string) => {
    const $tool = $tools.instance(type);
    const event = $tool.event;
    const agent = $sockets(null, event, {});
    return { event, agent };
};

//* main test body.
describe('WSSAgent', () => {
    //* check `$base64`.
    it('should pass basic function', async () => {
        const { agent } = instance();
        expect2(() => agent.hello()).toEqual('wss::');
    });
});
