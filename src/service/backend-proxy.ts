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
import { $U, _inf, _log, _err, NextContext, my_parrallel } from 'lemon-core';
import { $T } from '../cores/commons';
import { ModelType } from './backend-types';
import { BackendService } from './backend-service';
import { MyCoreProxy } from '../cores/abstract-services';
import { CallbackManagerProxy } from '../modules/callback/proxy';
import { MockManagerProxy, TestManagerProxy } from '../modules/mock/proxy';
import { ConnectionManagerProxy, SocketManagerProxy, ChannelManagerProxy } from '../modules/sockets/proxy';
import { ChannelModel } from '../modules/sockets/model';
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

        // STEP.2 build channel models
        const models: ChannelModel[] = [
            { id: masterId, channel },
            { id: channelId, stereo, channel },
        ];

        // STEP.3 get or create channel models in parallel
        const $models = await my_parrallel(models, N => this.channel.get(N.id, N));

        // STEP.4 prepare results
        const $master = $models?.at(0);
        const $channel = $models?.at(1);
        return { $master, $channel };
    }
}
