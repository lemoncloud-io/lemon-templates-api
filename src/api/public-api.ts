/**
 * `public-api.ts`
 * - api controller for `/public/{proxy+}` (auth NONE in API Gateway)
 * - relays `/public/<type>/<id>/<cmd...>` to the registered controllers only (ex: `mocks`).
 *
 * **[ RULES ]** (same as `LambdaWEBHandler.addPrefix()` of lemon-core PR #281)
 * - the mode is kept: `GET /public/mocks` → `mocks.doGet('')` (not LIST).
 * - only the registered controllers are reachable; others → `404 NOT FOUND`.
 * - a `$sub` in the client query is dropped.
 * - the path pieces are used as delivered (no decode here; lemon-core decodes them once in `asWebPath()`).
 * - a registered controller of type `public` wins over `addPrefix('public', …)`, so this stays valid after #281.
 *
 * ```sh
 * $ http ':8800/public/hello'
 * $ http ':8800/public/mocks/0/hello'
 * $ http POST ':8800/public/mocks/0/hello' name=hello
 * ```
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-11-04 initial version (proxy the `mocks` controller).
 *
 * @origin      see `eureka-flows-api/src/api/public-api.ts` (but keep every segment after `<id>` in `cmd`).
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err, GeneralWEBController, NextHandler, NextMode } from 'lemon-core';
const NS = $U.NS('pubs', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * class: `PublicAPIController`.
 * - controller for `/public/~` resource.
 */
export class PublicAPIController extends GeneralWEBController {
    /**
     * default constructor
     */
    public constructor() {
        super('public');
        _log(NS, `PublicAPIController()...`);
    }

    /**
     * name of this resource
     */
    public hello = () => `public-api-controller:${this.type()}`;

    /** registered target controllers (by `type()`) */
    protected controllers: Record<string, GeneralWEBController> = {};

    /**
     * register a target controller (reachable as `/public/<type>/…`).
     */
    public addController($api: GeneralWEBController) {
        const type = $api?.type();
        // the type is the first path piece, so it must exist and be unique.
        if (!type) throw new Error(`.type (string) is required - ${this.type()}`);
        if (this.controllers[type]) throw new Error(`.type[${type}] is duplicated - ${this.type()}`);
        this.controllers[type] = $api;
    }

    /**
     * decode `/public/<proxy>` to the handler of the target controller.
     * - lemon-core gives `id` = 1st piece of `{proxy+}`, `cmd` = the rest joined with `/`.
     * - returns `null` (→ `404 NOT FOUND`) if the target is not registered or has no handler.
     *
     * @override
     */
    public decode(mode: NextMode, id: string, cmd: string): NextHandler {
        // rebuild the whole proxy path, then split on the literal `/` (pieces are raw; never decode here).
        const proxy = `${id ?? ''}` + (cmd ? `/${cmd}` : '');
        const [type, targetId = '', ...rest] = proxy.split('/');
        const targetCmd = rest.join('/'); // keep every remaining segment (4th+ too).
        _inf(NS, `decode(${mode ?? ''}, ${proxy}) :=`, $U.json({ type, id: targetId, cmd: targetCmd }));

        // self check of the route: `/public/hello`.
        if (proxy === 'hello') return async () => ({ hello: this.hello() });

        // find the registered target, and its handler by the same mode.
        const $api = this.controllers[type];
        if (!$api) return null;
        const func = $api.decode(mode, targetId, targetCmd);
        if (!func) return null;

        // call the target as is: the context is passed through (NONE auth → guest), and the client `$sub` dropped.
        const next: NextHandler = async (_id, param, body, context) => {
            if (param && typeof param == 'object' && '$sub' in param) {
                param = { ...param };
                delete param.$sub;
            }
            return func.call($api, targetId, param, body, context);
        };
        return next;
    }
}

// default export
export default new PublicAPIController();
