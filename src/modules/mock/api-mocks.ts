/**
 * `api-mocks.ts`
 * - api controller for `/mocks`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $T, $U, _log, _inf, _err, NextHandler } from 'lemon-core';
import { AbstractCRUDController } from '../../cores';
import { MockModel } from './model';
import { MockModelManager } from './service';
import { $trans, MockTransformer } from './transformer';
import $LUT, { MockBody, MockView } from './views';
//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
const NS = $U.NS('mocks', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `MockAPIController`.
 */
export class MockAPIController extends AbstractCRUDController<
    ModelType,
    MockModel,
    MockView,
    MockBody,
    BackendService,
    MockModelManager,
    MockTransformer
> {
    /**
     * public constructor
     */
    public constructor(service: BackendService = $service) {
        super('mocks', service, service.$mock, $trans.mock);
        _log(NS, `MockAPIController()...`);
    }

    /**
     * name of this resource
     */
    public hello = () => `mock-api-controller:${this.type()}/${this.service.hello()}`;

    /**
     * GET /mocks/0/hello
     *
     * ```sh
     * $ http ':8888/mocks/0' name=hello stereo=#
     */
    public doGetHello: NextHandler = async (id, param, body, $ctx) => {
        return { id, hello: this.hello(), param, body, context: { clientIp: $ctx.clientIp } };
    };

    /**
     * get mocks layout
     * - make errors like 400, 404, ...
     *
     * @param id    model-id or name of mock
     *
     * ```sh
     * $ http :8888/mocks/0
     * $ http :8888/mocks/404
     * $ http :8888/mocks/400
     * $ http :8888/mocks/hello
     * $ http ':8888/mocks/site'        # load `mocks-site.yml`
     * $ http ':8888/mocks/site?i=0'    # 0th elements in list.
     * $ http ':8888/mocks/100001'      # pull by mock-id.
     */
    public doGet: NextHandler = async (id, param, body, context) => {
        const errScope = `doGet(${this.type()}/${id ?? ''})`;
        _log(NS, errScope);
        // STEP.0 validate parameters.
        param && _log(NS, `> param[${id}] =`, $U.json(param));
        body && _log(NS, `> body[${id}] =`, $U.json(body));
        context && _log(NS, `> context[${id}] =`, $U.json(context));
        id = id === '0' ? '' : $T.S2(id); // trim all white-space.

        // STEP.1 decode by id
        if (!id) throw new Error(`@id (string) is required - ${errScope}`);
        else if (id === '301') throw new Error(`301 REDIRECT - /`);
        else if (id === '302') throw new Error(`302 REDIRECT - /`);
        else if (id === '400') throw new Error(`400 INVALID - unknown!`);
        else if (id === '404') throw new Error(`404 NOT FOUND - model-id:${id}`);
        else if (id === '403') throw new Error(`403 ACCESS - login required!`);
        else if (id === '500') throw new Error(`@param(object) is invalid`);
        else if (id === '501') throw new Error(`.name(string) is invalid`);
        else if (id == 'hello') return { hello: this.hello() };
        else if (/^[a-z]+$/.test(id)) {
            const $ret = await this.service.$mock.loadFromFile(`mocks-${id}.yml`);
            const index = $T.N(param?.i, param?.i === '' ? 0 : -1);
            return index >= 0 ? $ret?.list?.[index] : $ret;
        } else if (id) return this.service.guardProxy(context, proxy => proxy.mock.pullMockBody(id));
    };

    /**
     * update(or create) mock-model by structured mock-body.
     * @returns list of mocks saved.
     *
     * ```sh
     * $ http :8888/mocks/0 name=hello
     * $ http :8888/mocks/0 name=hello type=world
     */
    public doPost: NextHandler = async (id, param, body, context) => {
        const errScope = `doPost(${this.type()}/${id ?? ''})`;
        _log(NS, errScope);
        // STEP.0 validate parameters.
        param && _log(NS, `> param[${id}] =`, $U.json(param));
        body && _log(NS, `> body[${id}] =`, $U.json(body));
        context && _log(NS, `> context[${id}] =`, $U.json(context));
        id = id === '0' ? '' : $T.S2(id); // trim all white-space.
        return this.service.guardProxy(context, proxy => proxy.mock.pushMockBody({ ...body, id }));
    };
}

// default export
export default new MockAPIController();
