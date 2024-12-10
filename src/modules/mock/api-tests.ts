/**
 * `api-tests.ts`
 * - api controller for `/tests`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $T, $U, _log, _inf, _err, NextHandler } from 'lemon-core';
import { AbstractCRUDController } from '../../cores';
import { TestModel } from './model';
import { TestModelManager } from './service';
import { $trans, TestTransformer } from './transformer';
import $LUT, { TestBody, TestView } from './views';
//WARN - use `BackendService` from main service due to proper `BackendProxy`.
import $service, { BackendService, ModelType } from '../../service/backend-service';
const NS = $U.NS('tests', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `TestAPIController`.
 */
export class TestAPIController extends AbstractCRUDController<
    ModelType,
    TestModel,
    TestView,
    TestBody,
    BackendService,
    TestModelManager,
    TestTransformer
> {
    /**
     * public constructor
     */
    public constructor(service: BackendService = $service) {
        super('tests', service, service.$test, $trans.test);
        _log(NS, `TestAPIController()...`);
    }

    /**
     * name of this resource
     */
    public hello = () => `test-api-controller:${this.type()}`;

    /**
     * GET /tests/0/hello
     *
     * ```sh
     * $ http ':8888/tests/0/hello'
     */
    public doGetHello: NextHandler = async (id, param, body, $ctx) => {
        return { id, hello: this.hello(), param, body, context: { clientIp: $ctx.clientIp } };
    };
}

// default export
export default new TestAPIController();
