/**
 * `backend-service.ts`: service for following user related features
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err } from 'lemon-core';
import { NextContext, NextIdentityAccess, $protocol, getIdentityId } from 'lemon-core';
import { Model } from './backend-model';
import { ModelType } from './backend-types';
import { BackendProxy } from './backend-proxy';
import { MyCoreService, $ES6Routed as $ES6 } from 'lemon-core';
import { SearchService, Elastic6Option } from '../modules/search/service';
import { CallbackModelManager } from '../modules/callback/service';
import { MockModelManager, TestModelManager } from '../modules/mock/service';
const NS = $U.NS('BACK', 'magenta'); // NAMESPACE TO BE PRINTED.
export { ModelType };

/**
 * class: `BackendService`
 */
export class BackendService extends MyCoreService<Model, ModelType, BackendProxy> {
    // model managers
    public readonly $callback: CallbackModelManager;
    public readonly $test: TestModelManager;
    public readonly $mock: MockModelManager;

    // search-service.
    public readonly search: SearchService;

    /**
     * constructor
     * @param tableName     target table-name
     * @param ns            namespace of dataset
     */
    public constructor(tableName?: string, ns?: string) {
        super(tableName, ns);
        _log(NS, `BackendService(${this.tableName || ''}, ${this.NS || ''})...`);

        // create model managers
        this.$callback = new CallbackModelManager(this);
        this.$test = new TestModelManager(this);
        this.$mock = new MockModelManager(this);

        // for SearchService
        this.search = this.createSearchService($ES6.options);
    }

    /**
     * say hello()
     */
    public hello = (): string => `backend-service:${this.NS}/${this.tableName}`;

    /**
     * create search-service with some batch-handlers.
     */
    public createSearchService = (options: Elastic6Option) => {
        const service = new SearchService(this.tableName, this.NS, options);
        // service.setBatchHandler('batch-mappings', async (list: MappingModel[], params: BatchParams<SimpleSet>) => {
        //     _log(NS, `batch-mappings($${list?.length})`);
        //     params && _log(NS, `> params =`, $U.json({ ...params, context: undefined }));
        //     // const { meta, index, context } = params;
        //     return this.batchMappingsForTransform(list);
        // });
        return service;
    };

    /**
     * make proxy instance w/ this service.
     */
    public createProxy = (context: NextContext) => {
        const proxy = new BackendProxy(context, this);
        return proxy;
    };

    /** */
    protected async fetchAccess($ctx: NextContext, domain = '') {
        const accountId = getIdentityId($ctx);
        if (!accountId) throw new Error(`.identityId is required - fetchAccess()!`);
        // 1. get user detail by invoking 'lemon-accounts-api/pack-context'
        const service = '//lemon-accounts-api/oauth/0/pack-context';
        const body = {
            domain: domain || $ctx.domain,
            identityId: accountId,
        };
        const identity: NextIdentityAccess = await $protocol($ctx, service).execute({}, body, 'POST');
        _log(NS, `> #lemon-accounts-api:/oauth/0/pack-context.res =`, $U.json(identity));
        if (!identity.Account) throw new Error(`.Account(NextIdentityAccess) is invalid!`);
        return { accountId, identity };
    }
}

// default export
export default new BackendService();
