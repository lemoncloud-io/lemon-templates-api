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
import { $base64, convertWSSEvent, parseBase64 } from './tools';

//! create service instance.
export const instance = (type?: string) => {
    const ld = (f: string) => loadJsonSync(`data/${f}${f.endsWith('.json') ? '' : '.json'}`);
    const event = type ? ld(type).event : null;
    const $evt = convertWSSEvent(event);
    return { $evt, event, ld };
};

//! main test body.
describe('WebSocketTools', () => {
    //! check `$base64`.
    it('should pass $base64', async () => {
        expect2(() => 'WklOAfLioE0CJPw='.length).toEqual(16);
        expect2(() => $base64.urlDecode('WklOAfLioE0CJPw=')).toEqual('5a494e01f2e2a04d0224fc');
        expect2(() => $base64.urlEncode('5a494e01f2e2a04d0224fc')).toEqual('WklOAfLioE0CJPw=');

        expect2(() => $base64.urlDecode('Wks_-eeMIE0CIjg=')).toEqual('5a4b3ff9e78c204d022238');
        expect2(() => $base64.urlEncode('5a4b3ff9e78c204d022238')).toEqual('Wks_-eeMIE0CIjg=');

        expect2(() => $base64.urlDecode('Wks_-_e-IE0CIjg=')).toEqual('5a4b3ffbf7be204d022238');
        expect2(() => $base64.urlEncode('5a4b3ffbf7be204d022238')).toEqual('Wks_-_e-IE0CIjg=');

        //! test parseBase64()
        expect2(() => parseBase64('Wks_-eeMIE0CIjg=')).toEqual('5a4b3ff9e78c204d022238');
    });

    //! check `$tools`.
    it('should pass $tools.', async () => {
        const { ld } = instance();
        const conv = (e: any) => convertWSSEvent(e);

        expect2(() => ld('wss-con-event.json').event.requestContext.eventType).toEqual('CONNECT');

        /* eslint-disable prettier/prettier */
        const _view = 'id,type,route';
        expect2(() => conv(ld('wss-con-event.json').event), _view).toEqual({ id: 'OjXY6FCWoE0Ee_Q=', type: 'CONNECT', route: '$connect' });
        expect2(() => conv(ld('wss-con2-event.json').event), _view).toEqual({ id: 'Om9k6EupoE0ER9g=', route: '$connect', type: 'CONNECT' });
        expect2(() => conv(ld('wss-dis-event.json').event), _view).toEqual({ id: 'OmwsjE-soE0EEpQ=', route: '$disconnect', type: 'DISCONNECT' });
        expect2(() => conv(ld('wss-dis2-event.json').event), _view).toEqual({ id: 'Om5C_H49IE0EJXA=', route: '$disconnect', type: 'DISCONNECT' });
        expect2(() => conv(ld('wss-msg-event.json').event), _view).toEqual({ id: 'OmwrPEBfIE0EI1g=', route: '$default', type: 'MESSAGE' });
        expect2(() => conv(ld('wss-msg2-event.json').event), _view).toEqual({ id: 'Om0aiEt7oE0EeMw=', route: '$default', type: 'MESSAGE' });

        expect2(() => conv(ld('wss-con-event.json').event), 'authorization').toEqual ({ authorization: '' });
        expect2(() => conv(ld('wss-con2-event.json').event), 'authorization').toEqual ({ authorization: '' });
        expect2(() => conv(ld('wss-con3-event.json').event), 'authorization').toEqual({ authorization: 'Basic bm9uZTpsZW1vbg==' });
    });
});
