/**
 * `service.ts`
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
import { $U, _inf, _log, _err, CoreModel, DynamoScanFilter, SimpleSet } from 'lemon-core';
import { $T, MyCoreManager, MyCoreService, SearchParam } from '../../cores';
import { $FIELD, ChannelModel, ConnectionModel, ModelType, SocketModel } from './model';
import { BackendProxy } from './proxy';
const NS = $U.NS('socket', 'blue'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendService` */
export interface BackendService<T extends ModelType = any> extends MyCoreService<CoreModel<T>, T, BackendProxy> {
    readonly $socket: SocketModelManager;
    readonly $connection: ConnectionModelManager;
    readonly $channel: ChannelModelManager;

    /** say hello() */
    hello(): string;
}

/**
 * class: `SocketModelManager`
 * - manager for socket-model.
 */
export class SocketModelManager extends MyCoreManager<SocketModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('socket', parent, $FIELD.socket);
    }

    /**
     * @override validate
     */
    public async validateModel(model: SocketModel, $org?: SocketModel) {
        const errScope = `validate(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        return model;
    }
}

/**
 * class: `ConnectionModelManager`
 * - manager for Connection-model.
 */
export class ConnectionModelManager extends MyCoreManager<ConnectionModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('connection', parent, $FIELD.connection);
    }

    /**
     * @override validate
     */
    public async validateModel(model: ConnectionModel, $org?: ConnectionModel) {
        const errScope = `validate(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        return model;
    }

    /** 목록 검색을 위한 추가 조건 스캔 필터 빌드 함수 */
    public asScanFilter(filter: DynamoScanFilter, params?: SearchParam<ConnectionModel> & SimpleSet): DynamoScanFilter {
        // STEP.1 build scan-filter w/ parameter.
        const _P = <T = string | number>(name: string): T => params && (params as any)[name];
        const _add_filter = (filter$: DynamoScanFilter | DynamoScanFilter[]) => {
            return [...((filter as DynamoScanFilter[]) || []), ...(Array.isArray(filter$) ? filter$ : [filter$])];
        };

        //* add custom filters.
        const $filter: DynamoScanFilter = [];
        const pChannel = _P<string>('channel');
        if (pChannel) {
            $filter.push({ key: 'channels', operator: 'contains', value: pChannel });
        }
        const pConnected = _P<string>('connected');
        if (pConnected) {
            $filter.push({ key: 'disConnectedAt', comparator: '<=', value: 0 });
        }

        // STEP.4 do merge array
        const $res = _add_filter($filter);
        return $res;
    }
}

/**
 * class: `ChannelModelManager`
 * - manager for channel-model.
 */
export class ChannelModelManager extends MyCoreManager<ChannelModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('channel', parent, $FIELD.channel);
    }

    /**
     * @override validate
     */
    public async validateModel(model: ChannelModel, $org?: ChannelModel) {
        const errScope = `validate(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        return model;
    }
}
