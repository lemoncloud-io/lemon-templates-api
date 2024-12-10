/**
 * `abstract-controllers.ts`
 * - pre-coded Model basic CRUD with backend-service and backend-proxy on GeneralWEBController.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2022-06-24 fixed some failures.
 * @date        2022-06-28 supports `doGetList` w/ search-id.
 * @date        2022-08-02 use `nextId()` w/ `manager.initialNo`.
 * @date        2022-08-03 improved `transformer` w/ helpers.
 * @date        2022-08-09 opt w/ `session-token` in CRUD.
 * @date        2022-09-21 optimized the model management.
 * @date        2022-11-09 param `isCreate` in `bodyToModel`, and support `GET /<type>/<cmd>/admin`
 * @date        2022-11-11 cleanup and optimized names.
 * @date        2022-12-29 optimized with `lemon-core@3.2.1`
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-01-20 optimized `doSearch()` w/ `SearchParam()`
 * @date        2023-02-09 optimized `doPutBulk()`, and `doPostBulk()`
 * @date        2023-02-13 optimized `doList()` to support `stereo` filter.
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 * @date        2023-05-31 optimized to use `cores` in `modelAsView()` & `makeModelBase()`
 * @date        2023-09-15 optimized to use `hasCores` in `modelAsView()`
 * @date        2023-09-27 optimized `doList()` to parse param.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/codes-backend-api/cores`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $T, $U, _log, _inf, _err, loadDataYml, NextContext, my_sequence } from 'lemon-core';
import { GeneralWEBController, NextHandler, my_parrallel, SimpleSet } from 'lemon-core';
import { CoreModel, AbstractTransformer, View, Body } from 'lemon-model';
import { BulkBody, ListResult, PaginatedListResult, PaginateParam } from './types';
import { MyCoreManager, MyCoreService, MyCoreProxy } from './abstract-services';
export { CoreModel, AbstractTransformer };

/**
 * convert as id string.
 */
const _id = (id: any): string => (id === '' || id === 0 ? '' : $T.S2(id));

/**
 * type: `CRUDCreationOptions`
 * - options for cunstructor.
 */
interface CRUDCreationOptions {
    /**
     * (optional) flag to use `session-token` in CRUD
     * - initialize this as `true` if required to use `session-token`
     *
     * @see proxy.getCurrentSession()
     */
    useSession?: boolean;
}

/**
 * class: `AbstractCRUDController`
 * - abstract high level class not to create directly.
 */
export abstract class AbstractCRUDController<
    ModelType extends string,
    MyModel extends CoreModel<ModelType>,
    MyView extends View,
    MyBody extends Body,
    MyService extends MyCoreService<MyModel, ModelType, MyCoreProxy<ModelType, any>>,
    MyManager extends MyCoreManager<MyModel, ModelType, MyCoreService<MyModel, ModelType, any>>,
    MyTransformer extends AbstractTransformer<MyModel, MyView, MyBody>,
> extends GeneralWEBController {
    /**
     * service instances
     */
    protected readonly service: MyService;

    /**
     * namespace for log(print)
     */
    protected readonly logNS: string;

    /**
     * my model manager
     */
    protected readonly manager: MyManager;

    /**
     * transformer between model and view.
     */
    protected readonly transformer: MyTransformer;

    /** options in creation */
    protected readonly options?: CRUDCreationOptions;

    /**
     * public constructor
     *
     * @param type - api controller's type name (ex: tests for `/tests`)
     * @param service - backend service
     * @param manager - my model manager in backend-service
     * @param transformer - GeneralCRUDWEBControllerOptions
     */
    public constructor(
        type: string,
        service: MyService,
        manager: MyManager,
        transformer: MyTransformer,
        options?: CRUDCreationOptions,
    ) {
        super(type);
        this.logNS = $U.NS(type, 'yellow');
        _log(this.logNS, `AbstractCRUDController(${type})...`);
        this.service = service;
        this.manager = manager;
        this.transformer = transformer;
        this.options = options;
    }

    /**
     * get the manager's type (= model-type)
     */
    public get modelType() {
        return this.manager.type;
    }

    /**
     * get config of using session.
     */
    public get confUseSession(): boolean {
        // _log(this.logNS, `! STAGE =`, $U.env('STAGE'));
        const STAGE = $U.env('STAGE');
        if (STAGE === 'local') return false;
        const useSession = this.options?.useSession ?? this.service.isUseSssion();
        return useSession;
    }

    /**
     * model transformer from model to view
     */
    public modelAsView(model: MyModel, options?: { useOnlyDefined?: boolean; hasCores?: boolean }): MyView {
        const useOnlyDefined = options?.useOnlyDefined ?? true;
        const hasCores = options?.hasCores ?? this.confUseSession;

        // show `cores` model { sid, gid uid } if using session.
        const view = this.transformer.modelAsView(model, hasCores);
        return useOnlyDefined ? this.transformer.onlyDefined(view) : view;
    }
    /**
     * model transformer from body to body
     */
    public bodyToModel(body: MyBody, isCreate?: boolean): MyModel {
        return this.transformer.bodyToModel(body, isCreate);
    }

    /**
     * from `session-token`, make base of model { sid, uid }
     * @param proxy the current proxy.
     * @returns base model
     */
    protected async makeModelBase(
        proxy: MyCoreProxy<ModelType, any>,
        options?: {
            /** use this parent to prepare base-model. (hiher than session) */
            parent?: CoreModel;
            /** flag to use session (default as confUseSession) */
            useSession?: boolean;
            /** flag to throw error (default true) */
            throwable?: boolean;
        },
    ): Promise<MyModel> {
        const useSession = options?.useSession ?? this.confUseSession;
        const throwable = options?.throwable ?? true;
        return proxy.makeModelBase<MyModel>({} as any, { useSession, throwable });
    }

    /** load yml as model list */
    public async loadMockData<T extends object>(name: string, base: string = null): Promise<T[]> {
        const file = base ? `${base}/${name}.yml` : `${name}.yml`;
        const $ret = await this.loadFromFile(file);
        const list = $ret?.list.map(N => ({ ...N } as T));
        return list;
    }

    /**
     * load mock-model from `.yml` file.
     */
    public async loadFromFile(file: string) {
        if (!file) throw new Error(`@file (string) is required!`);
        const isObjKey = (k: string) => /^[A-Z]+/.test(k);
        const { conf, data } = loadDataYml(file);
        const $id: { [key: string]: number } = {
            '': $T.N(conf?.$id, 1000), // global starting seq of id
        };
        const _id = (type: string, id = 0, auto = false): string => {
            if ($id[type] === undefined) {
                $id[type] = $id['']; // each starts of `type`.
                $id[''] += 10000; // shift by 10k.
            }
            const no = $id[type] + (auto ? 1 : id) - (auto ? 0 : $id[type] % 10000);
            $id[type] = Math.max($id[type], no); // save the last
            return `${no}`;
        };
        const _mock = (data: any, type: string, i?: number) =>
            Object.entries(data).reduce<any>(
                (M, [k, N]) => {
                    if (k === 'id') {
                        M[k] = _id(M.type, $T.N(N, 0) || i || 0, N === 0 ? true : false);
                    } else if (isObjKey(k)) {
                        const type = k.charAt(0).toLowerCase() + k.substring(1, k.length - 1);
                        const inner = Array.isArray(N) ? N.map((N, i) => _mock(N, N.type || type, i)) : _mock(N, type);
                        M[k] = inner;
                    } else if (/^[_]+/.test(k)) {
                        const type = k.substring(1);
                        const refId = _id(type, $T.N(N, 0));
                        M[`${type}Id`] = refId;
                    } else {
                        M[k] = N;
                    }
                    return M;
                },
                { type: type as ModelType },
            );
        //! load as list of mock-model.
        const mock = Array.isArray(data) ? data.map((N, i) => _mock(N, N.type || 'root', i)) : _mock(data, 'root');
        const list: any[] = Array.isArray(mock) ? mock : [mock];
        //! returns as mock-model.
        const result: MyModel = $U.copy_node(conf);
        return { ...result, list };
    }

    /**
     * say hello
     */
    public hello = () => `api:${this.type()}/${this.manager.hello()}`;

    /**
     * GET /<typeName>
     * - list types
     *
     * ```sh
     * $ http ':8888/<typeName>'
     */
    public doList: NextHandler<PaginateParam & SimpleSet, PaginatedListResult<MyView>> = async (
        id,
        param,
        body,
        $ctx,
    ) => {
        _log(this.logNS, `doList(${id}) ...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));

        // request search
        return this.service.guardProxy($ctx, async proxy => {
            //WARN - has no internal properties like `sid`, `uid`
            //TODO - `stereo` 같은 경우가 모델 생성시 필수값일때, 쿼리와 겹침. (not-exists) 개선필요함 @230926
            const model = param ? this.bodyToModel(param as any, true) : null; // could have all
            const useSession = this.confUseSession;

            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const { $page, $param } = $prxy.packSearchParam(param, model, { useSession });
            _log(this.logNS, `>> $param =`, $U.json($param));

            //* search from manager.
            const $res = await this.manager.list($page, $param);
            //* for internal test, list can be `SearchBody`
            const list = Array.isArray($res.list) ? $res.list.map(model => this.modelAsView(model)) : $res.list;
            const total = $res?.total ?? list.length;

            // return as view
            return { total, limit: $page.limit, page: $page.page, list };
        });
    };

    /**
     * list types by id
     * - id means the search(query) id to use.
     *
     * ```sh
     * $ http ':8888/<typeName>/<id>/list'
     */
    public doGetList: NextHandler<PaginateParam & SimpleSet, PaginatedListResult<MyView>> = async (
        id,
        param,
        body,
        $ctx,
    ) => {
        _log(this.logNS, `doGetList(${id}) ...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();

        // STEP.0 validate paramters.
        if (!id) throw new Error(`@id (string) is required!`);

        // redirect to list()
        return this.doList(id, param, body, $ctx);
    };

    /**
     * internal admin command
     */
    public doGetAdmin: NextHandler = async (id, param, body, $ctx) => {
        _log(this.logNS, `doGetAdmin(${id})..`);
        $ctx && _log(this.logNS, `> context =`, $U.json($ctx));

        const save = $T.B(param?.save, param?.save === '' ? 1 : 0);
        const clear = $T.B(param?.clear, param?.clear === '' ? 1 : 0);

        const isLocal = $ctx?.domain === 'localhost';
        const hello = this.hello();
        if (!isLocal && id) throw new Error(`403 NOT ALLOWED - only from local!`);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return this.service.guardProxy($ctx, async proxy => {
            //* initialize models w/ running environment.
            if (id === 'initialize') {
                //$ http ':8888/<type>/initialize/admin?clear'
                const list0 = await this.loadMockData<any>(this.manager.type, 'initial');
                const list1 = list0.map(N => this.bodyToModel(N, true));
                const list2 = await my_parrallel(list1, async N => {
                    if (save) return this.manager.prepare(N.id, N, true);
                    else if (clear) return this.manager.delete(N.id, true);
                    return N;
                });
                const list3 = list2.map(N => this.modelAsView(N));
                return { id, list: list3 };
            } else if (id) {
                const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
                const model = await $prxy.get(id);
                return model;
            }
            // returns default.
            return { id, hello, param, body, context: { clientIp: $ctx.clientIp } };
        });
    };

    /**
     * read a `MyModel`
     *
     * ```sh
     * $ http ':8888/<typeName>/1'
     */
    public doGet: NextHandler<any, MyView> = async (id, param, body, $ctx) => {
        _log(this.logNS, `doGet(${id}) ...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();

        // STEP.0 validate paramters.
        if (!id) throw new Error(`@id (string) is required!`);

        // STEP.1 (TODO) validate user, and transform to model.

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const model = await $prxy.get(id);
            if (model.deletedAt > 0) throw new Error(`404 NOT FOUND - ${this.modelType}:${id}`);
            return this.modelAsView(model);
        });
    };

    /**
     * create(or insert) a `MyModel`
     * - `id` must be empty (or '0')
     *
     * ```sh
     * $ http POST ':8888/<typeName>/0' "key"="modelValue"
     */
    public async doPost(id: string, param: any, body: MyBody, $ctx?: NextContext): Promise<MyView> {
        _log(this.logNS, `doPost(${id}) ...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();
        const isLocal = $ctx?.domain === 'localhost';

        // STEP.0 validate paramters.
        if (id && !isLocal) throw new Error(`@id (string) is invalid!`);
        if (body && Array.isArray(body)) return this.doPostBulk(id, param, body, $ctx) as any; //! route to `/bulk`

        // STEP.1 (TODO) validate user, and transform to model.
        const toCreate = this.bodyToModel(body, true);
        if (!toCreate) throw new Error(`@body is required - doPost(${id})`);
        if (id) toCreate.id = id;

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const base = await this.makeModelBase(proxy);
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const validated = await $prxy.validateModel(toCreate, null);
            const filtered = await $prxy.onBeforeSave(validated, null);
            const created = await $prxy.makeModel({ ...filtered, ...base }, false); //WARN! - already validated.
            return this.modelAsView(created);
        });
    }

    /**
     * create(or insert) multi `MyModel`
     * - `id` must be empty (or '0')
     *
     * ```sh
     * $ http POST ':8888/<typeName>/0/bulk' "key"="modelValue"
     */
    public doPostBulk: NextHandler<any, MyView[], BulkBody<MyBody> | MyBody[]> = async (id, param, body, $ctx) => {
        _log(this.logNS, `doPost(${id}) ...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id);

        // STEP.0 validate paramters.
        if (id) throw new Error(`@id (string) is invalid!`);
        const list = Array.isArray(body) ? body : body?.list;
        if (!list || !Array.isArray(list))
            throw new Error(`@body (array) is required - doPostBulk(${this.manager.type}:${id})`);

        // STEP.1 transform to models.
        const models = list.map(N => ({
            ...this.bodyToModel(N, true),
            id: _id(N?.id),
        }));

        // STEP.2 run main...
        return this.service.guardProxy($ctx, async proxy => {
            const $base = await this.makeModelBase(proxy);
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const validated = await Promise.all(models.map(N => $prxy.validateModel(N, null)));
            //* only for all validated models.
            const filtered = await my_sequence(validated, async validated => {
                const filtered = await $prxy.onBeforeSave(validated, null);
                const created = await $prxy.makeModel({ ...filtered, ...$base }, false); //WARN! - already validated.
                return created;
            });
            return filtered.map(created => this.modelAsView(created));
        });
    };

    /**
     * update a `MyModel`
     *
     * ```sh
     * $ http PUT ':8888/<typeName>/1000002' name="test-update"
     */
    public doPut: NextHandler<any, MyView, MyBody> = async (id, param, body, $ctx) => {
        _log(this.logNS, `doPut(${id}) ...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();

        // STEP.0 validate paramters.
        if (!id) throw new Error(`@id (string) is required!`);

        // STEP.1 (TODO) validate user, and transform to model.
        const toUpdate = this.bodyToModel({ ...body, id });
        if (!toUpdate) throw new Error(`@body is required - doPut(${id})`);

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const validated = await $prxy.validateModel(toUpdate, id);
            const filtered = await $prxy.onBeforeSave(validated, await $prxy.get(id));
            const updated = await $prxy.set(id, filtered);
            return this.modelAsView(updated);
        });
    };

    /**
     * delete a `MyModel`
     *
     * ```sh
     * $ http DELETE ':8888/<typeName>/1000003'
     */
    public doDelete: NextHandler<any, MyView> = async (id, param, body, $ctx) => {
        _log(this.logNS, `doDelete(${id}) ...`);
        param && _log(this.logNS, `> param =`, $U.json(param));
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id).trim();
        const isLocal = $ctx?.domain === 'localhost';
        const destroy = !!$T.B(param?.destroy, param?.destroy === '' ? 1 : 0);

        // STEP.0 validate paramters.
        if (!id) throw new Error(`@id (string) is required!`);

        // STEP.1 (TODO) validate user, and transform to model.

        // STEP.2 run main
        return this.service.guardProxy($ctx, async proxy => {
            const $prxy = proxy.getManagerProxy<MyModel, MyManager>(this.modelType);
            const $org = await $prxy.get(id, true);
            if (!destroy && $org?.deletedAt > 0) throw new Error(`404 NOT FOUND - ${this.manager.type}:${id}`);
            const deleted = await $prxy.$mgr.delete(id, isLocal && destroy);
            return this.modelAsView(deleted);
        });
    };

    /**
     * bulk update a `TypeModel`
     *
     * ```sh
     * $ http PUT ':8888/types/0/bulk'
     */
    public doPutBulk: NextHandler<any, ListResult<MyView>, BulkBody<MyBody> | MyBody[]> = async (
        id,
        param,
        body,
        $ctx,
    ) => {
        _log(this.logNS, `doPutBulk(${id}) ...`);
        body && _log(this.logNS, `> body =`, $U.json(body));
        id = id === '0' ? '' : $T.S2(id);

        const parrallel = $T.N(param?.parrallel, 10);
        const list = Array.isArray(body) ? body : body?.list;
        if (!list || !Array.isArray(list))
            throw new Error(`@body.list (array) is required - doPutBulk(${this.TYPE}/${id}})`);
        // transform to models
        const models = list.map(N => ({
            ...this.bodyToModel(N),
            id: _id(N?.id),
        }));
        // runs in guarded proxy.
        const $res = await this.service.guardProxy($ctx, async proxy => {
            const $mgr = proxy.getManagerProxy(this.modelType);
            if (!$mgr) throw new Error(`.model-type[${this.modelType}] is required!`);
            //* validate and update.
            const $res = await my_parrallel(
                models,
                async (model: MyModel, i) => {
                    if (!model?.id) throw new Error(`.id is required - doPutBulk(${this.type}:${i})`);
                    const validated = await $mgr.validateModel(model, model.id);
                    const filtered = await $mgr.onBeforeSave(validated, await $mgr.get(model.id));
                    const updated = await $mgr.set(model.id, filtered);
                    return updated;
                },
                parrallel,
            );
            // returns.
            return $res;
        });

        // prepare the response.
        const views = $res.map((N: MyModel) => this.modelAsView(N));
        const length = views.length;
        // FINAL. convert to view
        return { total: length, limit: length, list: views };
    };
}

//WARN! - do not export as default.
// default export
// export default AbstractCRUDController;
