/**
 * `tools.spec.ts`
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
import { expect2, _it, loadJsonSync } from 'lemon-core';
import { convertWSSEvent } from './tools';

//! create service instance.
export const instance = (type?: string) => {
    const ld = (f: string) => loadJsonSync(`data/${f}${f.endsWith('.json') ? '' : '.json'}`);
    const event = type ? ld(type).event : null;
    const $evt = convertWSSEvent(event);
    return { $evt, event, ld };
};

//! main test body.
describe('WebSocketTools', () => {
    //! check `$tools`.
    it('should pass $tools.', async () => {
        const { ld } = instance();
        const conv = (e: any) => convertWSSEvent(e);

        expect2(() => ld('wss-con-event.json').event.requestContext.eventType).toEqual('CONNECT');

        /* eslint-disable prettier/prettier */
        expect2(() => conv(ld('wss-con-event.json').event), 'id,type,route').toEqual({
            id: 'OjXY6FCWoE0Ee_Q=',
            type: 'CONNECT',
            route: '$connect',
        });
    });
});
