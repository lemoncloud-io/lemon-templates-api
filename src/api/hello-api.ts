/**
 * `hello-api.ts`
 * - common pattern controller for `/hello` w/ nestjs
 * - auto-routed from api-gateway via lambda handler in `serverless.yml`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-12 initial version
 * @date        2019-12-18 support notification event handler.
 * @date        2020-06-30 optimized with lemon-core#2.2.1
 * @date        2024-12-12 optimized self test by `/echo`
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import $cores, { _log, _inf, _err, $U, $info, $protocol } from 'lemon-core';
import { GeneralWEBController, NextContext, NextHandler, ProtocolService, GETERR$ } from 'lemon-core';
import $service, { BackendService } from '../service/backend-service';
const NS = $U.NS('hello', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `HelloAPIController`.
 * - support both Nest Controller & WebController
 */
class HelloAPIController extends GeneralWEBController {
    /**
     * default constructor()
     */
    public constructor(readonly service: BackendService = $service) {
        super('hello');
        _log(NS, `HelloController()...`);
    }

    /**
     * name of this resource.
     */
    public hello = () => `hello-api-controller:${this.type()}-${$U.env('NAME')}`;

    /**
     * say hello (internal purpose)
     *
     * ```sh
     * $ http ':8888/hello/0'
     * $ http PUT ~ => putHello()
     */
    public async getHello(id: string, param: any, body: any, context: NextContext) {
        _log(NS, `getHello(${id})..`);
        _log(NS, `> context =`, $U.json(context));
        const data: any = { hello: `${id}` };

        param = param && Object.keys(param).length > 0 ? param : { a: 'b' };
        body = body && Object.keys(body).length > 0 ? body : { x: 2 };

        if (id == '' || id == '0' || id == 'hello') {
            return { hello: this.hello() };
        } else if (id == 'environ') {
            // http ':8888/hello/environ'
            return {
                STAGE: $cores.cores.config.config.getStage(),
                SERVICE: $cores.cores.config.config.getService(),
                VERSION: $cores.cores.config.config.getVersion(),
                NAME: $cores.cores.config.config.get('NAME'),
                PROFILE: $cores.cores.config.config.get('PROFILE'),
                SESSION: this.service.isUseSession(), //* v5 B3: lemon-core removed the misspelled alias of this method
                _______: '______________', // line-break
                OS2_INDEX: $cores.cores.config.config.get('OS2_INDEX'),
                DEFAULT_REGION: $cores.cores.config.config.get('DEFAULT_REGION'),
                REPORT_ERROR_ARN: $cores.cores.config.config.get('REPORT_ERROR_ARN'),
                MY_DYNAMO_TABLE: $cores.cores.config.config.get('MY_DYNAMO_TABLE'),
                MY_SQS_ENDPOINT: $cores.cores.config.config.get('MY_SQS_ENDPOINT'),
                MY_SNS_ENDPOINT: $cores.cores.config.config.get('MY_SNS_ENDPOINT'),
            };
        } else if (id == 'echo') {
            return this.doGetEcho(id, param, body, context);
        } else if (id == 'protocol') {
            // http ':8888/hello/protocol'
            const { service: name } = $info();
            const service: ProtocolService = $cores.cores.protocol.service;
            const protocol = service.fromURL(context, `api://${name}/hello/echo`, param, body);
            data['protocol'] = protocol;
            data['self'] = service.myProtocolURI(context, 'hello');
        } else if (id == 'execute') {
            // http ':8888/hello/execute'
            const $proto = $protocol(context, '//self/hello/echo');
            data['protocol'] = $proto.asTargetUrl();
            data[id] = await $proto.execute(param, body, 'POST').catch(GETERR$);
        } else if (id == 'notify') {
            // http ':8888/hello/notify'
            const $proto = $protocol(context, '//self/hello/echo');
            data['protocol'] = $proto.asTargetUrl();
            data[id] = await $proto.notify(param, body, 'POST').catch(GETERR$);
        } else if (id == 'enqueue') {
            // http ':8888/hello/enqueue'
            const $proto = $protocol(context, '//self/hello/echo');
            data['protocol'] = $proto.asTargetUrl();
            data[id] = await $proto.enqueue(param, body, 'POST').catch(GETERR$);
        } else if (id == 'broadcast') {
            // http ':8888/hello/broadcast'
            const service: ProtocolService = $cores.cores.protocol.service;
            const protocol = service.fromURL(context, '//self/hello/echo', param, body);
            protocol.mode = 'POST';
            data['protocol'] = protocol;
            data[id] = await service.broadcast(context, 'lemon-todaq-out', { x: 2 }).catch(GETERR$);
        } else if (id == 'exception') {
            // http ':8888/hello/exception'
            throw new Error(`@id[${id}] (string) is invalid!`);
        }
        return data;
    }

    /**
     * post hello
     *
     * ```sh
     * $ http POST ':8888/hello/0'
     * $ http POST ':8888/hello/echo'
     */
    public postHello: NextHandler = async (id, param, body, context) => {
        _log(NS, `postHello(${id})...`);
        _log(NS, `> context =`, $U.json(context));
        if (id === 'echo') return this.doPostEcho(id, param, body, context);
        return { id, hello: this.hello(), body };
    };

    /**
     * action event from front app.
     *
     * ```sh
     * $ http ':8888/hello/me/action'
     */
    public async getHelloAction(id: string, param: any, body: any, context: NextContext) {
        _log(NS, `getHelloAction(${id})..`);
        param && _log(NS, `> param[${id}] =`, $U.json(param));
        body && _log(NS, `> body[${id}] =`, $U.json(body));
        context && _log(NS, `> context[${id}] =`, $U.json(context));
        //NOTE - stop linking user until refactoring done @191219.
        if (context) return 'NOP';
        // returns
        return { action: `${id}` };
    }

    /**
     * echo of the request info
     * - test all the required infra services like kms, sqs, sns, dynamodb, execute-api.
     *
     * ```sh
     * $ http ':8888/hello/0/echo'
     */
    public doGetEcho: NextHandler = (id, param, body, context) => this.doPostEcho(id, param, body, context);
    public async doPostEcho(id: string, param: any, body: any, context: NextContext) {
        _log(NS, `doPostEcho(${id})..`);
        return this.service.guardProxy(context, async proxy => {
            const { version } = $info();
            // check of dynamo-db
            const { count } = await proxy.test.get('#', { count: 0 }).then(N => proxy.test.inc(N.id, { count: 1 }));
            // returns w/ request.
            return {
                id,
                param,
                body: { ...body, count },
                context: { userAgent: context?.userAgent, identity: context?.identity, version },
            };
        });
    }
}

//! create default instance.
export default new HelloAPIController();
