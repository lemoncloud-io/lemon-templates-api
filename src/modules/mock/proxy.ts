/**
 * `proxy.ts`
 * - proxy of backend managers
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, $T, _inf, _log, _err, my_parrallel } from 'lemon-core';
import { MyCoreProxy, MyManagerProxy } from 'lemon-core';
import { ModelType, MockModel, MockModelExt, TestModel } from './model';
import { BackendService, MockModelManager, TestModelManager } from './service';
import { $trans } from './transformer';
const NS = $U.NS('mock', 'blue'); // NAMESPACE TO BE PRINTED.

/** resolve an id reference into its head snapshot. */
const resolveHead = async <T>(manager: any, id: string, asHead: (model: T) => any) => {
    const model = id ? await manager.get(id, false) : null;
    return model ? asHead(model) : null;
};

/** resolve id array references into head snapshots. */
const resolveHeads = async <T>(manager: any, ids: string[], asHead: (model: T) => any) => {
    const models = ids?.length ? await manager.mget(ids, false) : [];
    return models?.filter(Boolean).map((N: T) => asHead(N)) ?? [];
};

/** the expected `BackendProxy` */
export abstract class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    readonly mock: MockManagerProxy;
    readonly test: TestManagerProxy;

    // backend-service.
    readonly service: BackendService;
}

/**
/**
 * type: `MockManagerProxy`
 * - the manager-proxy for mock-model
 */
export class MockManagerProxy extends MyManagerProxy<MockModel, MockModelManager, BackendService> {
    /** default construction */
    public constructor(readonly proxy: BackendProxy, manager: MockModelManager) {
        super(proxy, manager);
    }

    /**
     * data transformer
     */
    public get trans() {
        return $trans.mock;
    }

    /**
     * validate before creating or updating.
     */
    public async validateModel<T extends MockModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const isCreate = !$org;
        const validated = await this.$mgr.validateModel(model, $org);

        //* test case for api calling.
        const errScope = `validate(${this.$mgr.type}/${modelId ?? ''})`;
        if (validated?.name == '#') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);
        if (isCreate && validated?.name == '!') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);
        if (isCreate && !validated?.name) throw new Error(`.name (string) is required - ${errScope}`);

        // //* update `parentId`
        // if (validated?.parentId !== undefined) {
        //     const mockId = validated?.parentId;
        //     if (!mockId || mockId == modelId) validated.parentId = '';
        //     else validated.parent$ = await this.get(mockId).then(N => $trans.mock.asHead(N));
        // }

        return validated as T;
    }

    /**
     * push(or save) the structured mock body w/ serialize()
     * @param body the request body
     */
    public async pushMockBody(body: MockModel) {
        const { id, meta } = body;
        if (typeof id != 'string') throw new Error(`.id[${id}] (string) is required - pushMockBody()`);
        if (meta) throw new Error(`.meta (any) is invalid - pushMockBody()`);

        // STEP.1 populate `.id` if need to create.
        body.id = id === '' ? await this.$mgr.nextId().then(n => `${n}`) : id;

        // STEP.2 serialize and save in parrallel.
        const list = this.$mgr.serialize(body);
        const results = await my_parrallel(list, async N => {
            const { id, stereo, meta } = N;
            const O = await this.get(id, { stereo, meta });
            O.stereo = stereo;
            O.meta = meta;
            return O;
        });

        // FINAL. list of models saved.
        return results;
    }

    /**
     * pull(or read) as the structured mock-body
     * @param id the target id.
     */
    public async pullMockBody(id: string, depth: number = 0) {
        if (typeof id != 'string' || depth > 4) return null;
        const model = await this.get(id);
        const body = this.$mgr.deserialize(model);
        //! pull all inner object.
        const list: any[] = await Promise.all(
            Object.entries(body)
                .map(([k, v]) => ({ k, v }))
                .map(N => {
                    if (this.$mgr.isObjKey(N.k)) {
                        if (Array.isArray(N.v))
                            return my_parrallel(
                                N.v.map(id => ({ id })),
                                N => this.pullMockBody(N.id, depth + 1),
                            ).then(V => ({ k: N.k, v: V }));
                        else return this.pullMockBody(N.v, depth + 1).then(V => ({ k: N.k, v: V }));
                    }
                    return N;
                }),
        );
        //! build as single structured.
        return list.reduce<MockModelExt>(
            (M, N) => {
                M[N.k] = N.v;
                return M;
            },
            { id },
        );
    }
}

/**
 * type: `TestManagerProxy`
 * - the manager-proxy for test-model
 */
export class TestManagerProxy extends MyManagerProxy<TestModel, TestModelManager, BackendService> {
    /** basic construction */
    public constructor(readonly proxy: BackendProxy, manager: TestModelManager) {
        super(proxy, manager);
    }

    /**
     * data transformer
     */
    public get trans() {
        return $trans.test;
    }

    /**
     * validate before creating or updating.
     */
    public async validateModel<T extends TestModel>(model: T, modelId?: string): Promise<T> {
        const $org = modelId ? await this.get(modelId, true) : null;
        const isCreate = !$org;
        const validated = await this.$mgr.validateModel(model, $org);

        //* test case for api calling.
        const errScope = `validate(${this.$mgr.type}/${modelId ?? ''})`;
        if (validated?.name == '#') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);
        if (isCreate && validated?.name == '!') throw new Error(`.name[${validated.name}] is invalid - ${errScope}`);
        if (isCreate && !validated?.name) throw new Error(`.name (string) is required - ${errScope}`);

        //* update mock$ if mockId is updated.
        if (validated?.mockId !== undefined) {
            validated.mock$ = await resolveHead(this.proxy.mock, validated.mockId, this.proxy.mock.trans.asHead);
        }
        //* update mock$$ if mockIds is updated.
        if (validated?.mockIds !== undefined) {
            validated.mock$$ = await resolveHeads(this.proxy.mock, validated.mockIds, this.proxy.mock.trans.asHead);
        }

        return validated as T;
    }

    /**
     * load as meta
     * - use `.meta` field of test-model to save any structured data for test-case, and load as object via this method.
     */
    public async loadMeta<T extends object>(id: string): Promise<T> {
        const model = await this.get(id, { stereo: '#meta' });
        try {
            const meta =
                typeof model?.meta === 'string' && model?.meta?.startsWith('{') ? JSON.parse(model.meta) : model.meta;
            return meta && typeof meta == 'object'
                ? (meta as T)
                : meta && typeof meta == 'string'
                ? ({ _: meta } as T)
                : null;
        } catch (e) {
            _err(NS, `> meta[${id}].err =`, e);
            return model?.meta && typeof model?.meta == 'string' ? ({ _: model?.meta } as T) : null;
        }
        return null as T;
    }

    /**
     * save as meta
     * - use `.meta` field of test-model to save any structured data for test-case, and save as json string via this method.
     */
    public async saveMeta<T extends object>(id: string, meta: T): Promise<T> {
        const $meta = await this.loadMeta(id);
        const meta2 = { ...$meta, ...meta };
        const saved = await this.set(id, { meta: $U.json(meta2) });
        _log(NS, `> meta[${id}] :=`, $U.json(saved?.meta));
        return meta2 as T;
    }
}
