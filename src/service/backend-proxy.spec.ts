/**
 * `tickets-proxy.spec.ts`
 * - unit test for `tickets-proxy` w/ dummy data
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2022-02-24 initial skeleton.
 * @date        2022-03-04 refactoring for activity service.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
import { loadProfile } from 'lemon-core/dist/environ';
import { expect2, NextIdentityAccess, _it, loadJsonSync, _log, GETERR } from 'lemon-core';
import { BackendProxy } from './backend-proxy';
import { AuthType, ServiceParams } from './backend-service.spec';
import * as $service from './backend-service.spec';
import { SocketEvent } from '../libs/wss/wss-types';
import { convertWSSEvent } from '../libs/wss/tools';
import { ChannelModel, ConnectionModel } from '../modules/sockets/model';
export { AuthType, ServiceParams };

/**
 * make service and proxy
 */
export const instance = (type: AuthType = 'authed', params?: ServiceParams) => {
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
    return { service, current, proxy, context, _ts };
};

//! main test body.
describe('BackendProxy', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE =', PROFILE);

    //! basic function
    it('should pass basic function', async () => {
        const { service, proxy, current } = instance();

        expect2(() => service.hello()).toEqual('backend-service:TT/dummy-data.yml');
        expect2(() => proxy.test.$mgr.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-data/_id',
        );
        expect2(() => proxy.test.$mgr.FIELDS.join(',')).toEqual(
            'name,count,extra,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error,id,_idx,_date',
        );

        expect2(() => proxy.asDate(null)).toEqual('@date[null] is invalid format!');
        expect2(() => proxy.asDate('')).toEqual('@date[] is invalid format!');
        expect2(() => proxy.asDate('2022-03-22')).toEqual('20220322');

        expect2(() => proxy.asIdOrIndex('2022-03-22')).toEqual('2022-03-22');
        expect2(() => proxy.asIdOrIndex(null as any)).toEqual(0);
        expect2(() => proxy.asIdOrIndex(undefined as any)).toEqual(0);
        expect2(() => proxy.asIdOrIndex('' as any)).toEqual(0);
        expect2(() => proxy.asIdOrIndex('0')).toEqual(0);
        expect2(() => proxy.asIdOrIndex('2')).toEqual(2);
        expect2(() => proxy.asIdOrIndex('11')).toEqual(11);
        expect2(() => proxy.asIdOrIndex('01')).toEqual('01');

        //! must pass of checking proxy w/ `_name`.
        const expectedS = {
            _id: 'TT:test:a',
            _idx: 2,
            _date: '11-22',
            id: 'a',
            ns: 'TT',
            type: 'test',
            createdAt: current,
            deletedAt: 0,
            updatedAt: current,
        };
        expect2(() => proxy.test.$mgr.FIELDS.filter(s => s.startsWith('_'))).toEqual(['_idx', '_date']);
        expect2(await proxy.test.$mgr.prepare('a', { _date: '11-22', _idx: 2 })).toEqual({
            ...expectedS,
        });
        expect2(await proxy.test.get('b', { _date: '11-22', _idx: 2 })).toEqual({
            ...expectedS,
            id: 'b',
            _id: undefined,
        });
    });

    //! test of `connect socket`
    it('should pass doConnect', async () => {
        const { proxy, service, _ts, current } = instance();
        const _loadEvent = (name: string): SocketEvent => {
            const data = loadJsonSync(`sample/wss.lemon/${name}.json`);
            const $event = convertWSSEvent(data?.event);
            return $event;
        };

        //! test of `doConnect`
        // STEP.0 - load event from sample file.
        const $eventA = _loadEvent('wss-con-event');
        expect2(() => $eventA, 'stage,domain,connectionId').toEqual({
            stage: 'dev',
            connectionId: 'OjXY6chgoE0CIdw=',
            domain: 'qksfa5jxm1.execute-api.ap-northeast-2.amazonaws.com',
        });

        // STEP.1 - 1st connect.
        const $connA = await proxy.doConnect($eventA);
        const connExp = {
            ..._ts('3a35d8e9c860a04d0221dc', 'connection'),
            stage: $eventA.stage,
            connectionId: $eventA.connectionId,
            domain: $eventA.domain,
            remote: $eventA.remote,
            agent: $eventA.agent,
            origin: $eventA.origin,
            reason: $eventA.reason,
            connectedAt: 1753928351091,
            disConnectedAt: 0,
            channel$$: [],
            channels: [],
        } as ConnectionModel;

        expect2(() => $connA).toEqual({ ...connExp });
        // STEP.1-2 - check retry connect.
        expect2(await proxy.doConnect($eventA)).toEqual({ ...connExp });

        // STEP.2 prepare channels.
        const [$chanA, $chanB] = await Promise.all(
            ['hello', 'public']
                .map((s, i) => ({ id: `${1000 + i}`, service: 'lemon-hello-api', modelType: s }))
                .map(N => proxy.channel.makeModel({ ...N })),
        );
        expect2(() => [$chanA, $chanB], 'id,service,modelType').toEqual([
            { id: '1000', service: 'lemon-hello-api', modelType: 'hello' },
            { id: '1001', service: 'lemon-hello-api', modelType: 'public' },
        ]);
        const _ch = (C: ChannelModel) => proxy.channel.trans.asHead(C);

        // STEP.2-1 link channels to connection model.
        expect2(await proxy.doConnect($eventA, [$chanA.id])).toEqual({
            ...connExp,
            channels: [$chanA.id],
            channel$$: [_ch($chanA)],
        });
        expect2(await proxy.doConnect($eventA, [$chanA.id, $chanB.id])).toEqual({
            ...connExp,
            channels: [$chanA.id, $chanB.id],
            channel$$: [_ch($chanA), _ch($chanB)],
        });
        // clear
        expect2(await proxy.doConnect($eventA, [])).toEqual({
            ...connExp,
        });
        expect2(await proxy.doConnect($eventA, ['C'])).toEqual({
            ...connExp,
        });

        expect2(await proxy.doConnect(null).catch(GETERR)).toEqual('@event (socket-event) is required - doConnect()');
        expect2(await proxy.doConnect({} as any).catch(GETERR)).toEqual(
            '.connectionId (string) is required - doConnect()',
        );
        expect2(await proxy.doConnect({ ...$eventA, stage: null } as any).catch(GETERR)).toEqual(
            `.stage (string) is required - doConnect(${$eventA.id})`,
        );
        expect2(await proxy.doConnect({ ...$eventA, domain: null } as any).catch(GETERR)).toEqual(
            `.domain (string) is required - doConnect(${$eventA.id})`,
        );

        //! test of `doDisconnect`
        const $eventB = _loadEvent('wss-dis-event');
        expect2(() => $eventB, 'type,connectionId,disConnectedAt,disconnectCode,reason').toEqual({
            type: 'DISCONNECT',
            connectionId: 'OjXY6chgoE0CIdw=',
            disconnectCode: 1005,
            reason: 'Client-side close frame status not set',
        });

        expect2(await proxy.doDisconnect($eventB).catch(GETERR)).toEqual({
            ...connExp,
            disconnectCode: $eventB.disconnectCode,
            reason: $eventB.reason,
            disConnectedAt: current,
        });
        expect2(await proxy.doDisconnect($eventB).catch(GETERR)).toEqual({
            ...connExp,
            disconnectCode: $eventB.disconnectCode,
            reason: $eventB.reason,
            disConnectedAt: current,
        });
        expect2(await proxy.doDisconnect(null).catch(GETERR)).toEqual(
            '@event (socket-event) is required - doDisconnect()',
        );
        expect2(await proxy.doDisconnect({} as any).catch(GETERR)).toEqual(
            '.connectionId (string) is required - doDisconnect()',
        );
        expect2(await proxy.doDisconnect({ ...$eventA, stage: null } as any).catch(GETERR)).toEqual(
            `.stage (string) is required - doDisconnect(${$eventA.id})`,
        );
        expect2(await proxy.doDisconnect({ ...$eventA, domain: null } as any).catch(GETERR)).toEqual(
            `.domain (string) is required - doDisconnect(${$eventA.id})`,
        );
    });
});
