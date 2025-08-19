/**
 * `api-channels.ts`
 * - api controller for `/channels`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-03-26 initial version.
 * @author      Aiden <aiden@lemoncloud.io>
 * @date        2025-08-19 refactored for channels service
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err, NextHandler } from 'lemon-core';
import { $T, AbstractCRUDController } from '../../cores';
import { ChannelModel } from './model';
import { ChannelModelManager } from './service';
import { $trans, ChannelTransformer } from './transformer';
import { ChannelBody, ChannelView } from './views';

//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
const NS = $U.NS('channels', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `ChannelAPIController`.
 */
export class ChannelAPIController extends AbstractCRUDController<
    ModelType,
    ChannelModel,
    ChannelView,
    ChannelBody,
    BackendService,
    ChannelModelManager,
    ChannelTransformer
> {
    /**
     * public constructor
     */
    public constructor(service: BackendService = $service) {
        super('channels', service, service.$channel, $trans.channel);
        _log(NS, `ChannelAPIController()...`);
    }

    /**
     * name of this resource
     */
    public hello = () => `channels-api-controller:${this.type()}`;

    /**
     * GET /channels/0/hello
     *
     * ```sh
     * $ http ':8832/channels/0/hello'
     *
     * $ http ':8832/channels/0' name=hello-v stereo=
     * $ http ':8832/channels/0' name=hello-d stereo=notice hidden=0 depth=0 order=0
     * $ http ':8832/channels/0' name=2nd stereo= parent=1000001 order=0
     */
    public doGetHello: NextHandler = async (id, param, body, $ctx) => {
        _log(NS, `doGetHello(${this.type()}/${id})..`);
        $ctx && _log(NS, `> context =`, $U.json($ctx));
        const hello = this.hello();

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            // returns default.
            return { id, hello, param, body, context: { clientIp: $ctx.clientIp } };
        });
    };

    /**
     * read in detail.
     *
     * ```sh
     * http ':8832/channels/1000001/detail'
     */
    public doGetDetail: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doGetDetail(${this.type()}/${id ?? ''})`;
        _log(NS, `${errScope}..`);
        $ctx && _log(NS, `> context =`, $U.json($ctx));

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            const $model = await proxy.channel.get(id);
            const $alias = await proxy.channel.getAlias$($model.service, $model.modelType);
            return this.modelAsView({ ...$model, $alias });
        });
    };

    /**
     * create(or insert) a `ChannelModel`
     * - `id` must be empty (or '0')
     *
     * ```sh
     * $ http POST ':8832/channels/0'
     * $ http POST ':8832/channels/0' service=lemon-cluster-api modelType=cluster
     * $ http POST ':8832/channels/0' service=lemon-cluster-api modelType=hello
     *
     * @override
     */
    public doPost: NextHandler = async (id, param, body, $ctx) => {
        const errScope = `doPost(${this.type()}/${id ?? ''})`;
        _log(this.logNS, `${errScope}...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();
        const isLocal = $ctx?.domain === 'localhost';

        // STEP.0 validate paramters.
        if (id && !isLocal) throw new Error(`@id (string) is invalid - ${errScope}`);
        if (body && Array.isArray(body)) return this.doPostBulk(id, param, body, $ctx) as any; //! route to `/bulk`

        // STEP.1 (TODO) validate user, and transform to model.
        const toCreate = this.bodyToModel(body, true);
        if (!toCreate) throw new Error(`@body is required - ${errScope}`);
        if (id) toCreate.id = id;

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const $base = await this.makeModelBase(proxy);
            const $prxy = proxy.getManagerProxy(this.modelType);
            const $valid = await $prxy.validateModel(toCreate, null);
            if (!proxy.canDo('create', { ...$valid, ...$base, type: this.modelType }, { errScope })) return null; // no permission to create.
            const $saves = await $prxy.onBeforeSave($valid, null);
            const $saved = await $prxy.makeModel({ ...$saves, ...$base }, true); //WARN! - muse be `true` for make alias.
            const $final = await $prxy.onAfterSave($saved, null);
            return this.modelAsView($final);
        });
    };
}

// default export
export default new ChannelAPIController();
