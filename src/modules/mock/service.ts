/**
 * `service.ts`
 * - proxy of backend managers
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, $T, _inf, _log, _err, loadDataYml, CoreModel } from 'lemon-core';
import { MyCoreManager, MyCoreService } from '../../cores';
import { $FIELD, ModelType, MockModel, MockModelExt, TestModel } from './model';
import { BackendProxy } from './proxy';
const NS = $U.NS('mock', 'blue'); // NAMESPACE TO BE PRINTED.

/** the expected `BackendService` */
export interface BackendService<T extends ModelType = any> extends MyCoreService<CoreModel<T>, T, BackendProxy> {
    readonly $mock: MockModelManager;
    readonly $test: TestModelManager;

    /** say hello() */
    hello(): string;
}

/**
 * class: `MockModelManager`
 * - manager for mock-model.
 */
export class MockModelManager extends MyCoreManager<MockModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('mock', parent, $FIELD.mock);
    }

    /**
     * @override validate
     */
    public async validateModel(model: MockModel, $org?: MockModel) {
        const errScope = `validate(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        // if (isCreate && !model?.name) throw Error('.name (string) is required');
        if (model?.name == '#') throw Error(`.name[${model?.name ?? ''}] is invalid - ${errScope}`);
        return model;
    }

    public isObjKey = (k: string) => /^[A-Z]+/.test(k);

    /**
     * load mock-model from `.yml` file.
     */
    public async loadFromFile(file: string) {
        if (!file) throw new Error(`@file (string) is required!`);
        const { conf, data } = loadDataYml(file);
        const $id: { [key: string]: number } = {
            '': $T.N(conf?.$id, 1000), // global starting seq of id
        };
        const _id = (type: string, id: number = 0, auto = false): string => {
            if ($id[type] === undefined) {
                $id[type] = $id['']; // each starts of `type`.
                $id[''] += 10000; // shift by 10k.
            }
            const no = $id[type] + (auto ? 1 : id) - (auto ? 0 : $id[type] % 10000);
            $id[type] = Math.max($id[type], no); // save the last
            return `${no}`;
        };
        const _mock = (data: any, type: string, i?: number) =>
            Object.entries(data).reduce<MockModelExt>(
                (M, [k, N]) => {
                    if (k === 'id') {
                        M[k] = _id(M.type, $T.N(N, 0) || i || 0, N === 0 ? true : false);
                    } else if (this.isObjKey(k)) {
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
        const list = Array.isArray(mock) ? mock : [mock];
        //! returns as mock-model.
        const result: MockModel = $U.copy_node(conf);
        return { ...result, list };
    }

    /**
     * serialize the structured model to array of { id, stereo, meta }
     * - save all body into `.meta` in json.
     * - `.Blocks[{ id }]` => `.Blocks[id]`
     */
    public serialize(model: MockModel): MockModel[] {
        const _red = (L: MockModel[], model: MockModel) => {
            if (!model) return null;
            const { id, type: stereo } = model;
            const meta = Object.entries(model).reduce<MockModelExt>((M, [k, v]) => {
                if (this.isObjKey(k)) {
                    M[k] = Array.isArray(v) ? v.map(N => _red(L, N)?.N?.id) : _red(L, v)?.N?.id;
                } else if (k != 'id' && k != 'type') {
                    M[k] = v;
                }
                return M;
            }, {});
            const N = { id, stereo, meta: $U.json(meta) };
            L.push(N);
            return { L, N };
        };
        return _red([], model).L;
    }

    /**
     * de-serialize a model.
     */
    public deserialize(model: MockModel): MockModel {
        const { id, stereo, meta } = model;
        const N =
            typeof meta == 'string' && meta.startsWith('{') && meta.endsWith('}')
                ? JSON.parse(meta)
                : meta && typeof meta == 'object'
                ? meta
                : {};
        const M: MockModel = { ...N, id, type: stereo };
        return M;
    }
}

/**
 * class: `TestModelManager`
 * - manager for test-model.
 */
export class TestModelManager extends MyCoreManager<TestModel, ModelType, BackendService> {
    public constructor(parent: BackendService) {
        super('test', parent, $FIELD.test);
    }

    /**
     * @override validate
     */
    public async validateModel(model: TestModel, $org?: TestModel) {
        const errScope = `validate(${this.type}/${model?.id ?? ''})`;
        const isCreate = !$org;
        if (isCreate && !model.name) throw Error(`.name (string) is required - ${errScope}`);
        if (model.count && model.count <= 0) throw Error(`.count (number) is required (greater than 0) - ${errScope}`);
        return model;
    }
}
