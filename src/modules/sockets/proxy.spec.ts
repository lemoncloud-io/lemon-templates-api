/**
 * `proxy.spec.ts`
 * - unit test for `tickets-proxy` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2022-02-24 initial skeleton.
 * @date        2022-03-04 refactoring for activity service.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
import { loadProfile } from 'lemon-core/dist/environ';
import { expect2, NextIdentityAccess, $info, loadJsonSync, GETERR } from 'lemon-core';
import { SocketEvent } from '../../libs/wss/wss-types';
import { convertWSSEvent } from '../../libs/wss/tools';
import { ConnectionModel } from './model';

import { BackendProxy } from '../../service/backend-proxy';
import * as $service from '../../service/backend-service.spec';

/**
 * make service and proxy
 */
export const instance = (type: $service.AuthType = 'authed', params?: $service.ServiceParams) => {
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
    return { service, current, proxy, context, _ts, $info: $info() };
};

//! main test body.
describe('BackendProxy', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE =', PROFILE);

    //! basic function
    it('should pass basic function', async () => {
        const { service, proxy, current } = instance();
        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
    });

    //* test of socket-manager
    it('should pass socket-manager(session)', async () => {
        const { service, proxy, current, _ts } = instance('session');
        const $cont = proxy.socket;

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        expect2(() => $cont.$mgr.hello()).toEqual(
            'typed-storage-service:socket/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
    });

    //* test of proxy
    it('should pass ConnectionManagerProxy', async () => {
        const { proxy, _ts, current } = instance('authed');
        const $conn = proxy.connection;

        const _loadEvent = (name: string): SocketEvent => {
            const data = loadJsonSync(`sample/wss.lemon/${name}.json`);
            const $event = convertWSSEvent(data?.event);
            return $event;
        };

        //* validate a findModel()
        const $eventA = _loadEvent('wss-con-event');
        expect2(() => $eventA, 'stage,domain,connectionId').toEqual({
            stage: 'dev',
            connectionId: 'OjXY6chgoE0CIdw=',
            domain: 'qksfa5jxm1.execute-api.ap-northeast-2.amazonaws.com',
        });

        // CASE 1: 새로운 연결 생성
        const $connA = await $conn.findModel($eventA);
        const expected: ConnectionModel = {
            connectionId: $eventA.connectionId,
            connectedAt: $eventA.connectedAt,
            disConnectedAt: 0,
            domain: $eventA.domain,
            remote: $eventA.remote,
            stage: $eventA.stage,
            origin: '',
            reason: '',
            agent: '',
        };
        expect2(() => $connA).toEqual({
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            ...expected,
        });

        // CASE 1.1: 동일한 연결 ID로 다시 호출 시 기존 연결 반환
        expect2(await $conn.findModel($eventA)).toEqual({
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            ...expected,
        });

        // CASE 2: 새로운 연결 생성
        const $eventB = _loadEvent(`wss-con2-event`);
        // CASE 3: 다른 connectionId로 새로운 연결 생성
        const $connB = await $conn.findModel($eventB);
        expect2(() => $connB).toEqual({
            ..._ts('3a6f64e9f6dfa04d02261c', 'connection'),
            ...expected,
            connectionId: $eventB.connectionId,
            connectedAt: $eventB.connectedAt,
            remote: $eventB.remote,
            agent: $eventB.agent,
            origin: $eventB.origin,
        });

        // CASE 3: 세션 이용할 경우.
        if (1) {
            const { proxy, _ts } = instance('session');
            const $eventC = _loadEvent('wss-con3-event');
            // CASE 3: 다른 connectionId로 새로운 연결 생성
            const $connC = await proxy.connection.findModel($eventC, { useSession: true });
            expect2(() => $connC).toEqual({
                ..._ts('3a6ec361d966204d022164', 'connection'),
                ...expected,
                connectionId: $eventC.connectionId,
                connectedAt: $eventC.connectedAt,
                remote: $eventC.remote,
                sid: '1000008',
                uid: '1000007',
            });
        }

        //! error cases
        expect2(await $conn.findModel(null).catch(GETERR)).toEqual(
            '@event (socket-event) is required - findModel(connection/)',
        );
        expect2(await $conn.findModel({ ...$eventA, connectionId: null }).catch(GETERR)).toEqual(
            '.connectionId (string) is required - findModel(connection/3a35d8e85096a04d047bf4)',
        );
        expect2(await $conn.findModel({ ...$eventA, stage: null }).catch(GETERR)).toEqual(
            '.stage (string) is required - findModel(connection/3a35d8e85096a04d047bf4)',
        );
        expect2(await $conn.findModel({ ...$eventA, domain: null }).catch(GETERR)).toEqual(
            '.domain (string) is required - findModel(connection/3a35d8e85096a04d047bf4)',
        );

        //* validate a updateConnection
        expect2(await $conn.updateConnection($connA, {})).toEqual({
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            ...expected,
        });
        expect2(await $conn.updateConnection({ id: $connA.id }, {})).toEqual({
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            ...expected,
        });
        expect2(await $conn.updateConnection($connA, { disconnectCode: 1005, disConnectedAt: current })).toEqual({
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            ...expected,
            disconnectCode: 1005,
            disConnectedAt: current,
        });
        expect2(await $conn.updateConnection($connA, { channels: [] })).toEqual({
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            ...expected,
            disconnectCode: 1005,
            disConnectedAt: current,
            channels: [],
            channel$$: [],
        });

        // link channel to connection
        const $channA = await proxy.channel.makeModel({ id: 'A:B', service: 'B', modelType: 'B' });
        expect2(() => $channA, 'id,service,modelType').toEqual({ id: 'A:B', service: 'B', modelType: 'B' });

        expect2(await $conn.updateConnection($connA, { channels: [$channA.id] })).toEqual({
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            ...expected,
            disconnectCode: 1005,
            disConnectedAt: current,
            channels: [$channA.id],
            channel$$: [proxy.channel.trans.asHead($channA)],
        });

        expect2(await $conn.updateConnection(null, null).catch(GETERR)).toEqual(
            '@model (connection-model) is required - updateConnection(connection/)',
        );
        expect2(await $conn.updateConnection({}, null).catch(GETERR)).toEqual(
            '@model.id (string) is required - updateConnection(connection/)',
        );
    });
});
