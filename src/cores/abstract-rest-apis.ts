/**
 * `abstract-rest-api.ts`
 * - support the rest-api pattern w/ remote service.
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-09-21 optimized w/ `abstract-rest-apis`
 * @date        2023-09-18 optimized `asProtocol()` w/ public.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/codes-backend-api/cores`
 */

import { $protocol, NextContext } from 'lemon-core';
import { Reversable } from 'lemon-model';
import { onlyDefined } from './commons';
import { PaginatedListResult, PaginateParam } from './types';
export { Reversable };

/**
 * support rest-api from remote service.
 * - useful to use the common CRUD RestAPI.
 */
export class RestAPI<View extends object = any, Body = View, Model = View> {
    public constructor(
        public readonly context: NextContext,
        public readonly endpoint: string,
        public readonly _reverser?: Reversable<Model, View, Body>,
        public readonly options?: { isProd?: boolean },
    ) {}

    /** translate protocol */
    public asProtocol(id?: string, cmd?: string) {
        const _nul = (v: any) => v === undefined || v === null;
        const _has = (v: any) => !_nul(v);
        const service =
            _has(id) && _has(cmd)
                ? `${this.endpoint}/${id}/${cmd}`
                : _has(id)
                ? `${this.endpoint}/${id}`
                : this.endpoint;
        return $protocol(this.context, service, { isProd: this.options?.isProd });
    }

    /** get the current transform (may throw error) */
    public get reverser() {
        if (!this._reverser) {
            // throw new Error(`.transform is required - setup before use!`);
            return {
                asModel: (V: View): Model => ({ ...V } as any),
                asBody: (M: Model): Body => ({ ...M } as any),
            };
        }
        return this._reverser;
    }

    /** say hello */
    public hello = () => `rest-api:${this.endpoint}`;

    /** list model as view */
    public list = <T extends PaginateParam>(param?: T) =>
        this.asProtocol().execute<PaginatedListResult<View>>(param, null, 'GET');
    /** read model as view */
    public read = (id: string, param?: any) => this.asProtocol(id).execute<View>(param, null, 'GET');
    /** insert model w/ body w/o id */
    public insert = (body: Body, param?: any) => this.asProtocol('0').execute<View>(param, body, 'POST');
    /** update model w/ body by id */
    public update = (id: string, body: Body, param?: any) => this.asProtocol(id).execute<View>(param, body, 'PUT');
    /** delete model by id */
    public delete = (id: string, param?: any) => this.asProtocol(id).execute<View>(param, null, 'DELETE');

    /** enqueue vis SQS */
    public enqueue = (
        params: { id?: string; cmd?: string; mode?: string; param?: any; body?: any; callback?: string },
        delay?: number,
    ) => {
        const id = params?.id ?? '';
        const cmd = params?.cmd ?? null;
        const mode = params?.mode || 'POST';
        const callback = params?.callback;
        return this.asProtocol(id, cmd).enqueue(params?.param, params?.body, mode, callback, delay);
    };

    /** execute vis API */
    public execute = <T = any>(params: { id?: string; cmd?: string; mode?: string; param?: any; body?: any }) => {
        const id = params?.id ?? '';
        const cmd = params?.cmd ?? null;
        const mode = params?.mode || 'POST';
        return this.asProtocol(id, cmd).execute<T>(params?.param, params?.body, mode);
    };

    /**
     * set by model.
     */
    public set = async (id: string, model: Model): Promise<Model> => {
        const body = onlyDefined<Body>(this.reverser.asBody(model));
        const saved = await this.update(id, body);
        return onlyDefined(this.reverser.asModel(saved));
    };

    /**
     * get by id
     */
    public get = async (id: string, throwable?: boolean): Promise<Model> => {
        const view = await this.read(id).catch(e => {
            if (throwable) throw e;
            return null as View;
        });
        return onlyDefined(this.reverser.asModel(view));
    };

    /**
     * make new (w/ auto id)
     */
    public new = async (model: Model): Promise<Model> => {
        const body = onlyDefined<Body>(this.reverser.asBody(model));
        const saved = await this.insert(body);
        return onlyDefined(this.reverser.asModel(saved));
    };

    /**
     * delete (w/ auto id)
     */
    public del = async (id: string): Promise<Model> => {
        const saved = await this.delete(id);
        return onlyDefined(this.reverser.asModel(saved));
    };
}

/**
 * rest-api for dummy
 * - save model in memory.
 */
export class DummyRestAPI<View = any, Body = View, Model = View> extends RestAPI {
    public constructor(
        public readonly context: NextContext,
        public readonly endpoint: string,
        public readonly _reverser?: Reversable<Model, View, Body>,
        public initialNo: number = 80000,
    ) {
        super(context, endpoint, _reverser);
    }

    /** say hello */
    public hello = () => `dummy-rest-api:${this.endpoint}`;

    /** internal dummy memory */
    protected $buf: { [key: string]: any } = {};

    public read = async (id: string, param?: any): Promise<View> => {
        const view = this.$buf[id];
        if (view === undefined) throw new Error(`404 NOT FOUND - dummy-id:${id}`);
        return view ? { ...view } : view;
    };

    public insert = async (body: any, param?: any): Promise<View> => {
        const id = `${++this.initialNo}`;
        const view: View = { ...body, id };
        this.$buf[id] = view;
        return view ? { ...view } : view;
    };

    public update = async (id: string, body: any, param?: any): Promise<View> => {
        const $org = this.$buf[id];
        if ($org === undefined) throw new Error(`404 NOT FOUND - dummy-id:${id}`);
        const view: View = { ...$org, ...body };
        this.$buf[id] = view;
        return view ? { ...view } : view;
    };

    public delete = async (id: string, param?: any): Promise<View> => {
        const view = this.$buf[id];
        if (view === undefined) throw new Error(`404 NOT FOUND - dummy-id:${id}`);
        delete this.$buf[id];
        return view ? { ...view } : view;
    };
}

/**
 * factory to create `rest-api` instance for both real and dummy.
 */
export const $createApi = <View extends object = object, Body = View, Model = View>(
    $context: NextContext,
    endpoint: string,
    reversor?: Reversable<Model, View, Body>,
    options?: {
        isProd?: boolean;
        isDummy?: boolean;
        initialNo?: number;
    },
): RestAPI<View, Body, Model> => {
    if (options?.isDummy) return new DummyRestAPI<View, Body, Model>($context, endpoint, reversor, options?.initialNo);
    return new RestAPI<View, Body, Model>($context, endpoint, reversor, { isProd: options?.isProd });
};
