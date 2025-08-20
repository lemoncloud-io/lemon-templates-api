/**
 * `backend-proxy.ts`
 * - proxy of backend managers
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _inf, _log, _err, NextContext, my_parrallel, SearchQuery } from 'lemon-core';
import { $T, onlyDefined, parsePaginateParam } from '../cores/commons';
import { ModelType } from './backend-types';
import { BackendService } from './backend-service';
import { MyCoreProxy } from '../cores/abstract-services';
import { CallbackManagerProxy } from '../modules/callback/proxy';
import { MockManagerProxy, TestManagerProxy } from '../modules/mock/proxy';
import { ConnectionManagerProxy, SocketManagerProxy, ChannelManagerProxy } from '../modules/sockets/proxy';
import { ChannelModel, ConnectionModel } from '../modules/sockets/model';
import { SocketEvent, SocketMessagePayload, SocketModelMeta, SocketResponse } from '../libs/wss/wss-types';
import { buildSocketResponse } from '../libs/wss/tools';
import { ListResult } from '../cores';
const NS = $U.NS('backend', 'blue'); // NAMESPACE TO BE PRINTED.

/**
 * class: `BackendProxy`
 * - manager proxy to handle micro-transaction.
 */
export class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    public readonly socket: SocketManagerProxy;
    public readonly connection: ConnectionManagerProxy;
    public readonly channel: ChannelManagerProxy;

    public readonly callback: CallbackManagerProxy;
    public readonly test: TestManagerProxy;
    public readonly mock: MockManagerProxy;

    /**
     * constructor of proxy.
     * @param context the current request context
     * @param service the main backend service
     */
    public constructor(context: NextContext, service: BackendService) {
        super(context, service);
        _log(NS, `BackendProxy(${service.NS})..`);

        this.socket = new SocketManagerProxy(this, service.$socket);
        this.connection = new ConnectionManagerProxy(this, service.$connection);
        this.channel = new ChannelManagerProxy(this, service.$channel);

        this.callback = new CallbackManagerProxy(this, service.$callback);
        this.test = new TestManagerProxy(this, service.$test);
        this.mock = new MockManagerProxy(this, service.$mock);
    }

    /**
     * make indexed id w/ parent-id
     */
    public asIndexId = (parent: string, i: number, delim = ':') => {
        if (typeof i !== 'number' || i < 0) throw new Error(`@i[${i}] (number) is invalid - asIndexId(${parent})`);
        return `${parent || ''}${delim}${i}`;
    };

    /**
     * pull out parent-id
     */
    public asParentIndexId = (id: string, delim = ':') => {
        const parts = id.split(delim);
        if (parts.length === 1) {
            return '';
        } else {
            parts.pop();
            return parts.join(delim);
        }
    };

    /**
     * verify and convert as date (YYYYMMDD)
     */
    public asDate = (s: string, delimJoin = '') => {
        if (!/^[0-9]{4}\-?[01][0-9]\-?[0-3][0-9]$/.test(s)) throw new Error(`@date[${s}] is invalid format!`);
        return s.split('-').join(delimJoin);
    };

    /**
     * if in string -> must be `id`, or index number.
     */
    public asIdOrIndex = (s: string | number, maxLen = 2) => {
        if (typeof s === 'number') return s;
        if (s === '0' || s === null || s === undefined || s === '') return 0;
        if (typeof s === 'string' && s.length <= maxLen && /^[1-9][0-9]{0,5}$/.test(s)) return $T.N(s);
        return s;
    };

    /**
     * establish a channel group
     * @deprecated 미사용 제거예정.
     */
    public async establishChannel(
        channel: string,
        stereo: string,
    ): Promise<{
        $master: ChannelModel;
        $channel: ChannelModel;
    }> {
        const errScope = `establishChannel(${channel ?? ''}/${stereo ?? ''})`;

        // STEP.0 validate parameters
        if (!channel) throw new Error(`@channel (string) is required - ${errScope}`);
        if (!stereo) throw new Error(`@stereo (string) is required - ${errScope}`);

        // STEP.1 prepare master & sub channel model.
        const masterId = this.channel.asChannelId(channel);
        const channelId = this.channel.asChannelId(channel, stereo);
        const type = `${stereo}` as any;

        // STEP.2 build channel models
        const models: ChannelModel[] = [
            { id: masterId, channel },
            { id: channelId, stereo: type, channel },
        ];

        // STEP.3 get or create channel models in parallel
        const $models = await my_parrallel(models, N => this.channel.get(N.id, N));

        // STEP.4 prepare results
        const $master = $models?.at(0);
        const $channel = $models?.at(1);
        return { $master, $channel };
    }

    /**
     * 소켓 연결 이벤트 수신 시, 커넥션 정보 저장을 처리함.
     * - find connection model by `event`
     * - retrieve channels in parallel
     * - link channels to connection model
     */
    public async doConnect(
        event: SocketEvent,
        channelIds?: string[],
        options?: { errScope?: string },
    ): Promise<ConnectionModel> {
        const errScope = options?.errScope ?? `doConnect(${event?.id ?? ''})`;

        // STEP.1 find connection model.
        const $conn = await this.connection.findModel(event, { errScope });

        // STEP.2 retrieve channels in parrallel.
        const ids = channelIds?.map(id => ({ id })) || [];
        const $list = await my_parrallel(ids, async (N, i) => {
            if (!N?.id) throw new Error(`.id (string) is required (at channels[${i}]) - ${errScope}`);
            const $chan = await this.channel.get(N.id, false);
            if (!$chan) throw new Error(`.id[${N.id}] is invalid (not found) - ${errScope}`);
            return $chan;
        }).then(L => L.filter(N => N && !N?.error));

        // update `channels[] and populate channel$$`
        const $ups = onlyDefined<ConnectionModel>({
            channels: $list.map(N => N.id),
            channel$$: $list.map(N => this.channel.trans.asHead(N)),
        });
        // STEP.3 link channels to connection model.
        const $result = await this.connection.updateConnection($conn, $ups, { errScope });
        _inf(NS, `> $conn[${$conn?.id}].channels =`, $result?.channels ?? []);

        // returns.
        return $result;
    }

    /**
     * 소켓 해제 이벤트 수신 시, 커넥션 해제 정보 저장을 처리함.
     */
    public async doDisconnect(
        event: SocketEvent,
        options?: { errScope?: string; current?: number },
    ): Promise<ConnectionModel> {
        const errScope = options?.errScope ?? `doDisconnect(${event?.id ?? ''})`;
        const current = options?.current ?? this.connection.storage.storage.getTime();

        // STEP.1 find connection model.
        const $conn = await this.connection.findModel(event, { errScope, useSession: false });
        if ($conn?.disConnectedAt > 0) {
            _inf(NS, `> $conn[${$conn?.id}] already disconnectedAt`, $U.ts($conn?.disConnectedAt));
            return $conn;
        }

        // STEP.2 update connection model w/ disconnected info.
        const $ups = onlyDefined<ConnectionModel>({
            disconnectCode: event?.disconnectCode,
            reason: event?.reason,
            disConnectedAt: current,
        });
        const $result = await this.connection.updateConnection($conn, $ups, { errScope });
        _inf(NS, `> $conn[${$conn?.id}].disconnectAt =`, $U.ts($result?.disConnectedAt));

        // returns.
        return $result;
    }

    /**
     * 특정 채널에 메시지를 전송함.
     */
    public async prepareBroadcast(
        payload: SocketMessagePayload,
        options?: { errScope?: string },
    ): Promise<{
        $channel: ChannelModel;
        $msg: SocketResponse<SocketModelMeta>;
        list: ConnectionModel[];
        connIds: string[];
    }> {
        const errScope = options?.errScope ?? `prepareBroadCast(${payload?.service ?? ''}/${payload?.modelType ?? ''})`;
        _log(NS, `...${errScope}`);

        // STEP.1 find channel by alias
        const { service, modelType, data } = payload;
        const $channel = await this.channel.findByAlias(service, modelType, { throwable: false });
        if (!$channel) throw new Error(`.alias[${service}@${modelType}] is invalid (not found) - ${errScope}`);

        // STEP.2 prepare message
        const channel = $T.S2($channel.id);
        const $msg = buildSocketResponse('message', data, { channel });

        // STEP.3 search available connections by channel
        const { list, total } = await this.listAvailableConnections($channel);
        _log(NS, `> $channel[${$channel.id}].connections count = `, total);

        // STEP.4 filter out connections
        const connIds = list?.map(N => N?.id)?.filter(N => !!N) || [];

        // returns.
        return { $channel, $msg, list, connIds };
    }

    /**
     * list the available connections by channel.
     */
    public async listAvailableConnections(
        $channel: ChannelModel,
        options?: { useSearch?: boolean; limit?: number; page?: number },
    ): Promise<ListResult<ConnectionModel>> {
        const errScope = `listAvailableConnections()`;
        const $prf = $T.perf();
        const useSearch = options?.useSearch ?? true;
        const $page = parsePaginateParam(options);
        if (!$channel?.id) throw new Error(`@channel.id (string) is required - ${errScope}`);

        const $conn = this.connection.$mgr;
        const channel = $T.S2($channel.id);
        const _scan = async () => {
            const $def = $conn.buildScanFilter();
            const filter = $conn.asScanFilter($def, { channel, connected: 1 });
            const $res = await $conn.doScan($page, filter);
            return $res;
        };
        const _search = async (): Promise<ListResult<ConnectionModel, { key: string; count: number }>> => {
            const body = $conn.buildQuery($page);
            const $must: SearchQuery[] = [];
            if (channel) {
                $must.push({ terms: { channels: [channel] } });
                $must.push({
                    bool: {
                        should: [
                            { bool: { must_not: { exists: { field: 'disConnectedAt' } } } },
                            { range: { disConnectedAt: { lte: 0 } } },
                        ],
                        minimum_should_match: 1,
                    },
                });
            }
            body.query.bool.must = $must;

            const $res = await $conn.parent.doSearch<ConnectionModel>(body);
            return { list: $res?.list, total: $res?.total, aggr: null };
        };

        const $res = useSearch ? await _search() : await _scan();
        const { list, total, aggr } = $res;
        const took = $prf.took();
        _log(NS, `> search.took = `, took);

        return { ...$page, list, total, aggr, took };
    }
}
