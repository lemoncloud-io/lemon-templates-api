/**
 * `tools.spec.ts`
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
import { expect2, _it, loadJsonSync, $U } from 'lemon-core';
import { $base64, convertWSSEvent, parseBase64, parseBody, parseMessage, buildSocketResponse } from './tools';

//! create service instance.
export const instance = (type?: string) => {
    const ld = (f: string) => loadJsonSync(`sample/wss.lemon/${f}${f.endsWith('.json') ? '' : '.json'}`);
    const event = type ? ld(type).event : null;
    const $evt = convertWSSEvent(event);
    return { $evt, event, ld };
};

//* main test body.
describe('WebSocketTools', () => {
    //* check `$base64`.
    it('should pass $base64', async () => {
        expect2(() => 'WklOAfLioE0CJPw='.length).toEqual(16);
        expect2(() => $base64.urlDecode(null)).toEqual('');
        expect2(() => $base64.urlDecode('')).toEqual('');
        expect2(() => $base64.urlDecode('WklOAfLioE0CJPw=')).toEqual('5a494e01f2e2a04d0224fc');
        expect2(() => $base64.urlEncode('5a494e01f2e2a04d0224fc')).toEqual('WklOAfLioE0CJPw=');

        expect2(() => $base64.urlDecode('Wks_-eeMIE0CIjg=')).toEqual('5a4b3ff9e78c204d022238');
        expect2(() => $base64.urlEncode('5a4b3ff9e78c204d022238')).toEqual('Wks_-eeMIE0CIjg=');

        expect2(() => $base64.urlDecode('Wks_-_e-IE0CIjg=')).toEqual('5a4b3ffbf7be204d022238');
        expect2(() => $base64.urlEncode('5a4b3ffbf7be204d022238')).toEqual('Wks_-_e-IE0CIjg=');

        //* test parseBase64()
        expect2(() => parseBase64('Wks_-eeMIE0CIjg=')).toEqual('5a4b3ff9e78c204d022238');
    });

    //* check `$tools`.
    it('should pass $tools.', async () => {
        const { ld } = instance();
        const conv = (e: any) => convertWSSEvent(e);

        expect2(() => ld('wss-con-event.json').event.requestContext.eventType).toEqual('CONNECT');

        const _view = 'id,type,route';
        expect2(() => conv(ld('wss-con-event.json').event), _view).toEqual({
            id: 'OjXY6FCWoE0Ee_Q=',
            type: 'CONNECT',
            route: '$connect',
        });
        expect2(() => conv(ld('wss-con2-event.json').event), _view).toEqual({
            id: 'Om9k6EupoE0ER9g=',
            route: '$connect',
            type: 'CONNECT',
        });
        expect2(() => conv(ld('wss-dis-event.json').event), _view).toEqual({
            id: 'OmwsjE-soE0EEpQ=',
            route: '$disconnect',
            type: 'DISCONNECT',
        });
        expect2(() => conv(ld('wss-dis2-event.json').event), _view).toEqual({
            id: 'Om5C_H49IE0EJXA=',
            route: '$disconnect',
            type: 'DISCONNECT',
        });
        expect2(() => conv(ld('wss-msg-event.json').event), _view).toEqual({
            id: 'OmwrPEBfIE0EI1g=',
            route: '$default',
            type: 'MESSAGE',
        });
        expect2(() => conv(ld('wss-msg2-event.json').event), _view).toEqual({
            id: 'Om0aiEt7oE0EeMw=',
            route: '$default',
            type: 'MESSAGE',
        });

        expect2(() => conv(ld('wss-con-event.json').event), 'authorization').toEqual({ authorization: '' });
        expect2(() => conv(ld('wss-con2-event.json').event), 'authorization').toEqual({ authorization: '' });
        expect2(() => conv(ld('wss-con3-event.json').event), 'authorization').toEqual({
            authorization: 'Basic bm9uZTpsZW1vbg==',
        });
    });

    it('should pass tools spec', async () => {
        //* test parseBody()
        expect2(() => parseBody('')).toEqual({ body: '' });
        expect2(() => parseBody('!')).toEqual({ body: '!' });
        expect2(() => parseBody('{}')).toEqual({});
        expect2(() => parseBody('{.}')).toEqual({ body: '{.}', error: expect.any(String) });

        expect2(() => parseBody('', 'data')).toEqual({ data: '' });
        expect2(() => parseBody('!', 'data')).toEqual({ data: '!' });
        expect2(() => parseBody('{}', 'data')).toEqual({});
        expect2(() => parseBody('{.}', 'data')).toEqual({ data: '{.}', error: expect.any(String) });

        //* test parseMessage()
        expect2(() => parseMessage('')).toEqual({ action: '' });
        expect2(() => parseMessage('!')).toEqual('.action[!] is invalid key - asLut(action)');
        expect2(() => parseMessage('{}')).toEqual({ action: '' });
        expect2(() => parseMessage('{"action":"hi"}')).toEqual('.action[hi] is invalid key - asLut(action)');
        expect2(() => parseMessage('{.}')).toEqual({ action: '', data: '{.}', error: expect.any(String) });

        expect2(() => parseMessage(null)).toEqual({ action: '', data: null });
        expect2(() => parseMessage(undefined)).toEqual({ action: '', data: undefined });
        expect2(() => parseMessage(0)).toEqual({ action: '', data: 0 });
        expect2(() => parseMessage({ x: 2 })).toEqual({ action: '', data: { x: 2 } });
        expect2(() => parseMessage('{"!":"hi"}')).toEqual({ action: '', '!': 'hi' });
        expect2(() => parseMessage('{"action":"ping"}')).toEqual({ action: 'ping' });
        expect2(() => parseMessage($U.json({ id: 1, action: '', data: {}, ts: 0 }))).toEqual({
            id: 1,
            action: '',
            data: {},
            ts: 0,
        });
    });

    it('should pass tools spec', async () => {
        //* test buildSocketResponse()
        const now = 1704067200000;
        expect2(() => buildSocketResponse('ping')).toEqual({ action: 'ping', timestamp: expect.any(Number) });
        expect2(() => buildSocketResponse('pong', { message: 'hello' })).toEqual({
            action: 'pong',
            result: { message: 'hello' },
            timestamp: expect.any(Number),
        });
        expect2(() => buildSocketResponse('echo', 'test data', { current: now })).toEqual({
            action: 'echo',
            result: 'test data',
            timestamp: now,
        });
        expect2(() => buildSocketResponse('', null)).toEqual({
            action: '',
            result: null,
            timestamp: expect.any(Number),
        });

        const complexData = {
            users: [
                { id: 1, name: 'John' },
                { id: 2, name: 'Jane' },
            ],
            metadata: { total: 2, page: 1 },
        };
        expect2(() => buildSocketResponse('message', complexData)).toEqual({
            action: 'message',
            result: complexData,
            timestamp: expect.any(Number),
        });
    });
});
