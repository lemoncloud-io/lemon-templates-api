/**
 * `service.ts`
 * - proxy of backend managers
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _inf, _log, _err, CoreModel } from 'lemon-core';
import { $FIELD, CallbackModel, ModelType } from './model';
import { MyCoreManager, MyCoreService } from '../../cores';
import { SearchService } from '../search/service';
import { BackendProxy } from './proxy';
const NS = $U.NS('callback', 'blue'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendService` */
export interface BackendService<T extends ModelType = any> extends MyCoreService<CoreModel<T>, T, BackendProxy> {
    readonly $callback: CallbackModelManager;

    // search-service.
    readonly search: SearchService;

    /** say hello() */
    hello(): string;
}

/**
 * class: `CallbackModelManager`
 * - manager for callback-model.
 */
export class CallbackModelManager extends MyCoreManager<CallbackModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('callback', parent, $FIELD.callback);
    }

    /**
     * @override validate
     */
    public async validateModel(model: CallbackModel, $org?: CallbackModel) {
        const errScope = `validateModel(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        if (isCreate && model?.name == '#') throw Error(`.name[${model?.name}] is invalid - ${errScope}`);
        return model;
    }
}
