/**
 * `proxy.ts`
 * - proxy of backend managers
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 * @author      Aiden <aiden@lemocloud.io>
 * @date        2025-07-23 refactored for sockets service
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, $T, _inf, _log, _err } from 'lemon-core';
import { MyCoreProxy, MyManagerProxy, onlyDefined } from '../../cores';
import { ChannelModel, ConnectionModel, ModelType, SocketModel } from './model';
import { BackendService, ChannelModelManager, ConnectionModelManager, SocketModelManager } from './service';
import { $trans, SocketTransformer } from './transformer';
import { SocketEvent } from '../../lib/wss-types';
import { parseBase64 } from '../../lib/tools';
const NS = $U.NS('sockets', 'blue'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendProxy` */
export abstract class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    readonly socket: SocketManagerProxy;
    readonly connection: ConnectionManagerProxy;
    readonly channel: ChannelManagerProxy;

    // backend-service.
    readonly service: BackendService;
}

/**
 * type: `SocketManagerProxy`
 * - the manager-proxy for socket-model
 */
export class SocketManagerProxy extends MyManagerProxy<SocketModel, SocketModelManager, BackendService> {
    /** default construction */
    public constructor(readonly proxy: BackendProxy, manager: SocketModelManager) {
        super(proxy, manager);
    }

    /** get the transformer */
    public get trans(): SocketTransformer {
        return $trans.socket;
    }

    /**
     * validate before creating or updating.
     */
    public async validateModel<T extends SocketModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const isCreate = !$org;
        const validated = await this.$mgr.validateModel(model, $org);

        //* test case for api calling.
        const errScope = `validate(${this.$mgr.type}/${modelId ?? ''})`;
        if (validated?.name == '#') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);
        if (isCreate && validated?.name == '!') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);

        // returns.
        return validated as T;
    }
}
/**
 * type: `ConnectionManagerProxy`
 * - the manager-proxy for connection-model
 */
export class ConnectionManagerProxy extends MyManagerProxy<ConnectionModel, ConnectionModelManager, BackendService> {
    /** default construction */
    public constructor(readonly proxy: BackendProxy, manager: ConnectionModelManager) {
        super(proxy, manager);
    }

    /**
     * validate before creating or updating.
     */
    public async validateModel<T extends ConnectionModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const isCreate = !$org;
        const validated = await this.$mgr.validateModel(model, $org);

        //* test case for api calling.
        const errScope = `validate(${this.$mgr.type}/${modelId ?? ''})`;
        if (isCreate && !validated?.connectionId) throw new Error(`.connectionId (string) is required - ${errScope}`);

        // returns.
        return validated as T;
    }

    /**
     * get or craete a connection model from socket-event
     */
    public async findModel(
        event?: SocketEvent,
        options?: { useSession?: boolean; errScope?: string; validate?: boolean },
    ): Promise<ConnectionModel> {
        const errScope = options?.errScope ?? `findModel(${this.$mgr.type}/${event?.id ?? ''})`;
        const validate = options?.validate ?? true;
        const useSession = options?.useSession ?? false;
        const $sess = useSession ? this.proxy.getCurrentSession({ useSession }) : null;

        /** STEP.0 validate paramters */
        if (validate) {
            if (!event) throw new Error(`@event (socket-event) is required - ${errScope}`);
            if (!event?.connectionId) throw new Error(`.connectionId (string) is required - ${errScope}`);
            if (!event?.stage) throw new Error(`.stage (string) is required - ${errScope}`);
            if (!event?.domain) throw new Error(`.domain (string) is required - ${errScope}`);
        }

        /** STEP.1 extract paramters */
        const { connectionId, stage, domain } = event;
        const connId = parseBase64(connectionId);
        const connectedAt = $T.N(event?.connectedAt, this.storage.storage.getTime());

        /** STEP.2 build connection model */
        const $def = onlyDefined<ConnectionModel>({
            id: connId,
            stage,
            domain,
            connectionId,
            connected: 1,
            connectedAt,
            origin: event?.origin,
            remote: event?.remote,
            reason: event?.reason,
            agent: event?.agent,
            sid: $sess?.sid,
            uid: $sess?.uid,
        });
        /** STEP.3 get or create connection model */
        return this.get(connId, $def);
    }

    /**
     * update connection model w/ disconnection info
     */
    public async updateDisconnection(
        event?: SocketEvent,
        options?: { errScope?: string; validate?: boolean; current?: number },
    ): Promise<ConnectionModel> {
        const errScope = options?.errScope ?? `updateDisconnection(${this.$mgr.type}/${event?.id ?? ''})`;
        const validate = options?.validate ?? true;
        const current = options?.current ?? this.storage.storage.getTime();

        /** STEP.0 validate parameters */
        if (validate) {
            if (!event) throw new Error(`@event (socket-event) is required - ${errScope}`);
            if (!event?.connectionId) throw new Error(`.connectionId (string) is required - ${errScope}`);
        }

        /** STEP.1 extract parameters */
        const { connectionId, reason } = event;
        const connId = parseBase64(connectionId);

        // STEP.2 find a model
        const $conn = await this.get(connId, false);
        if ($conn?.id !== connId)
            throw new Error(`.connId[${connId}] is invalid (expected as ${$conn?.id ?? ''}) - ${errScope}`);
        if ($conn?.disConnectedAt > 0) return $conn; // bypass

        /** STEP.3 decrease connected count */
        const $dec = await this.inc($conn.id, { connected: -1 });
        _log(NS, `> $conn[${$conn.id}].connected = `, $dec?.connected);

        // STEP.4 prepare updates
        const $ups = onlyDefined<ConnectionModel>({
            disconnectCode: event?.disconnectCode,
            disConnectedAt: current,
            reason,
        });
        const $final = await this.set($conn.id, $ups);
        return $final;
    }
}

/**
 * type: `ChannelManagerProxy`
 * - the manager-proxy for channel-model
 */
export class ChannelManagerProxy extends MyManagerProxy<ChannelModel, ChannelModelManager, BackendService> {
    /** default construction */
    public constructor(readonly proxy: BackendProxy, manager: ChannelModelManager) {
        super(proxy, manager);
    }

    /**
     * validate before creating or updating.
     */
    public async validateModel<T extends ChannelModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const isCreate = !$org;
        const validated = await this.$mgr.validateModel(model, $org);

        //* test case for api calling.
        const errScope = `validate(${this.$mgr.type}/${modelId ?? ''})`;

        // returns.
        return validated as T;
    }

    /**
     * convert to `channel-id`
     * @param channel   name of channel
     * @param stereo    stereo as `role`.
     */
    public asChannelId = (channel: string, stereo?: string) => (stereo ? `${channel}.${stereo}` : `${channel}`);
}
