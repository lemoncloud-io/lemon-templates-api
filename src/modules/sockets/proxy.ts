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
import { $U, $T, _inf, _log, _err, SearchQuery, my_parrallel, NUL404 } from 'lemon-core';
import { ListResult, MyCoreProxy, MyManagerProxy, onlyDefined, parsePaginateParam } from '../../cores';
import { ChannelModel, ConnectionModel, ModelType, SocketModel } from './model';
import { BackendService, ChannelModelManager, ConnectionModelManager, SocketModelManager } from './service';
import { $trans, ChannelTransformer, SocketTransformer } from './transformer';
import { SocketEvent } from '../../libs/wss/wss-types';
import { parseBase64 } from '../../libs/wss/tools';
import { ChannelStereo } from './types';
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
        _log(NS, `...${errScope}`);
        const validate = options?.validate ?? true;
        const useSession = options?.useSession ?? $U.env('USE_SESSION');
        const $sess = useSession ? this.proxy.getCurrentSession(options) : null;

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
            disConnectedAt: 0,
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
     * update connection model
     */
    public async updateConnection<T extends ConnectionModel>(
        model: T,
        $ups: T,
        options?: { errScope?: string },
    ): Promise<T> {
        const errScope = options?.errScope ?? `updateConnection(${this.$mgr.type}/${model?.id ?? ''})`;

        /** STEP.0 validate parameters */
        if (!model) throw new Error(`@model (connection-model) is required - ${errScope}`);
        if (!model?.id) throw new Error(`@model.id (string) is required - ${errScope}`);

        /** STEP.1 extract parameters */
        const $updates = onlyDefined<T>({ ...$ups });

        // STEP.2 validate and update model
        const $valid = await this.validateModel($updates, model.id);
        const $final = await this.set(model.id, $valid);
        return $final as T;
    }

    /**
     * list the available connections by channel.
     * @param channel
     * @param options
     * @returns
     */
    public async listAvailableConns(
        channel: string,
        options?: { useSearch?: boolean },
    ): Promise<ListResult<ConnectionModel>> {
        const errScope = `listAvailableConns(${this.$mgr.type}/${channel ?? ''})`;
        const $prf = $T.perf();
        const useSearch = options?.useSearch ?? false;
        const $page = parsePaginateParam({ limit: 30 });
        if (!channel) throw new Error(`@channel (string) is required - ${errScope}`);

        const _scan = async () => {
            const $def = this.$mgr.buildScanFilter();
            const filter = this.$mgr.asScanFilter($def, { channel, connected: 1 });
            const $res = await this.$mgr.doScan($page, filter);
            return $res;
        };
        const _search = async (): Promise<ListResult<ConnectionModel, { key: string; count: number }>> => {
            const body = this.$mgr.buildQuery($page);
            const $must: SearchQuery[] = [];
            if (channel) {
                $must.push({ terms: { channels: channel } });
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

            const $res = await this.$mgr.parent.doSearch<ConnectionModel>(body);
            return { list: $res?.list, total: $res?.total, aggr: null };
        };

        const $res = useSearch ? await _search() : await _scan();
        const { list, total, aggr } = $res;
        const took = $prf.took();
        _log(NS, `> search.took = `, took);

        return { ...$page, list, total, aggr, took };
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

    /** get the transformer */
    public get trans(): ChannelTransformer {
        return $trans.channel;
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

        //* make sure of alias
        const id = validated?.id || modelId;
        if (id && (validated?.service !== undefined || validated?.modelType !== undefined)) {
            const service = $T.S2(validated.service);
            const modelType = $T.S2(validated.modelType);
            const $res = await this.updateAlias(service, modelType, { ...validated, id }, { errScope });
            _log(NS, `> final alias =`, $U.json($res));
            validated.service = $res?.service ?? '';
            validated.modelType = $res?.modelType ?? '';
        }

        // returns.
        return validated as T;
    }

    /**
     * convert to `channel-id`
     * @param channel   name of channel
     * @param stereo    stereo as `role`.
     * @deprecated not used anymore. use `alias` instead.
     */
    public asChannelId = (channel: string, stereo?: string) => (stereo ? `${channel}.${stereo}` : `${channel}`);

    /** as alias-id */
    public asAliasId = (
        /** the topic name of channel */
        service: string,
        /** the model type */
        modelType: string,
        options?: { prefix?: string; stereo?: ChannelStereo; delim?: string },
    ) => {
        const prefix = options?.prefix ?? '@';
        const stereo = options?.stereo ?? 'alias';
        const _service = service?.toLocaleLowerCase() ?? '-';
        const _modelType = modelType?.toLocaleLowerCase() ?? '-';
        const delim = options?.delim ?? ':';
        return [`${prefix}${stereo}`, _service, _modelType].join(delim);
    };

    /**
     * find(or make) the alias model
     */
    public async getAlias$(
        /** the topic name of channel */
        service: string,
        /** the model type */
        modelType: string,
        /** (optional) */
        options?: { throwable?: boolean; errScope?: string; stereo?: ChannelStereo },
    ): Promise<ChannelModel> {
        const throwable = options?.throwable ?? true;
        const errScope = options?.errScope ?? `findAlias(${this.$mgr.type ?? ''}/${service ?? ''}@${modelType ?? ''})`;
        const stereo = options?.stereo ?? 'alias';
        if (!service) return null;
        try {
            const id = this.asAliasId(service, modelType, { stereo });
            const $def = onlyDefined<ChannelModel>({ stereo, id, service, modelType });
            const $base = await this.proxy.makeModelBase($def, { useSession: true, throwable: false });
            const $alias = await this.get(id, $base);
            const isValid = $alias?.id && $alias.stereo === stereo;
            if (!isValid)
                throw new Error(`.stereo[${id}/${$alias?.stereo ?? ''}] is invalid (not ${stereo}) - ${errScope}`);
            return $alias;
        } catch (e) {
            if (throwable) throw e;
            return null;
        }
    }

    /**
     * update(or change) the alias of channel.
     *
     * @param service service to be updated
     * @param modelType modelType to be updated
     * @param $valid channel-model in valiadation.
     *
     * @returns the alias model by service and modelType.
     */
    public async updateAlias(
        service: string,
        modelType: string,
        $valid?: ChannelModel,
        options?: { errScope?: string },
    ): Promise<ChannelModel> {
        const errScope =
            options?.errScope ?? `updateAlias(${this.$mgr.type ?? ''}/${service ?? ''}@${modelType ?? ''})`;
        const modelId = $valid?.id;
        const $org = modelId ? await this.get(modelId, false) : null;
        if ($org?.id && $org?.id !== modelId)
            throw new Error(`@channel.id[${$org?.id ?? ''}] is invalid (miss by ${modelId}) - ${errScope}`);

        //* `.service` 혹은 `.modelType`이 기존에서 변경된 경우 처리하기
        const diff = $U.diff($org || {}, $valid || {});
        const _changed = (key: keyof ChannelModel) => diff.includes(key) && $valid[key] !== undefined;
        if (_changed('service') || _changed('modelType')) {
            const $alias = await this.getAlias$($org?.service, $org?.modelType);
            if ($alias?.id) await this.set($alias?.id, { aliasId: '', alias$: null });
        }

        //* re-link the alias by service&modelType.
        const $alias = await this.getAlias$(service, modelType);
        if ($alias?.aliasId && modelId && $alias?.aliasId !== modelId)
            throw new Error(
                `.alias[${service ?? ''}/${modelType ?? ''}] is invalid (occupied by ${
                    $alias?.aliasId ?? ''
                }) - ${errScope}`,
            );
        const $ups = onlyDefined<ChannelModel>({
            modelType,
            service,
            aliasId: modelId ?? '',
            alias$: this.trans.asHead({ ...$org, ...$valid }),
        });
        const $res = $alias?.id ? await this.set($alias.id, $ups) : $alias;
        _log(NS, `>> final alias :=`, $U.json($res));
        return $res;
    }

    /**
     * find model by `service` and `modelType` w/ alias
     * - use `makeModel()` to make alias in auto.
     */
    public findByAlias = (
        service: string,
        modelType: string,
        options?: { throwable?: boolean; errScope?: string },
    ): Promise<ChannelModel> => this.findByAlias$(service, modelType, { ...options, detail: false });
    public async findByAlias$(
        service: string,
        modelType: string,
        options?: { throwable?: boolean; errScope?: string; detail?: boolean },
    ): Promise<ChannelModel> {
        const errScope =
            options?.errScope ?? `findByAlias$(${this.$mgr.type ?? ''}/${service ?? ''}@${modelType ?? ''})`;
        const throwable = options?.throwable ?? true;
        const detail = options?.detail ?? false;

        //* find the alias by code.
        const $alias = await this.getAlias$(service, modelType, options);
        if (!$alias?.aliasId) {
            if (throwable) throw new Error(`404 NOT FOUND - channel by alias@${errScope}`);
            return null;
        }

        //* find target channel by alias.
        const $channel = await this.get($alias?.aliasId, false).catch(NUL404);
        if (!$channel?.id) {
            if (throwable) throw new Error(`404 NOT FOUND - channel[${$alias?.aliasId}] by alias @${errScope}`);
            return null;
        }
        if (detail) return { ...$channel, $alias }; // return the detail info.
        return $channel;
    }
}
