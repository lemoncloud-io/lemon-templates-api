/**
 * `commons.ts`
 * - common tools to export.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-11-01 optimized w/ `commons`
 * @date        2024-06-24 optimized `parseListParam()`
 * @date        2025-01-03 optimized `parseListParam()` w/ `offset`
 * @date        2025-02-25 optimized `parsePaginateParam()` w/ `noLimit`
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/codes-backend-api/cores`
 */
import { GeneralItem } from 'lemon-model';
import { ListParam, PaginateParam } from './types';

import * as $core from 'lemon-core';
const _T = $core.$T;

/**
 * extract only the defined attribute.
 * ex) `{ a:1, b: undefined }` -> `{ a:1 }`
 */
export const onlyDefined = <T>(N: T) =>
    N && typeof N === 'object'
        ? Object.entries(N).reduce<T>((N, [k, v]) => {
              if (v !== undefined) N[k as keyof T] = v;
              return N;
          }, {} as T)
        : null;

/**
 * list param parser
 * @param param
 */
export function parseListParam(param?: ListParam, $def?: { limit?: number }): Required<ListParam> {
    return onlyDefined({
        sort: param?.sort !== undefined ? _T.S2(param?.sort, '') : undefined,
        limit: _T.N(param?.limit, $def?.limit ?? 10),
    });
}

/**
 * paginate param parser
 */
export function parsePaginateParam(
    param?: PaginateParam,
    /** default value or conditions */
    options?: { noLimit?: boolean; limit?: number; page?: number },
): PaginateParam {
    const limit = options?.limit;
    const page = options?.page ?? 0;
    const res = onlyDefined<PaginateParam>({
        ...parseListParam(param, { limit }),
        page: _T.N(param?.page, page),
        offset: param?.offset !== undefined ? _T.N(param?.offset, 0) : undefined,
    });
    const noLimit = options?.noLimit ?? res.limit == -1;
    const MAX_LIMIT = $T.N($core.$U.env('MAX_LIMIT', '2000'));
    if (MAX_LIMIT <= 0) throw new Error(`@env.MAX_LIMIT[${MAX_LIMIT}] (number) is invalid!`);

    //WARN! - limit the max result to 2000.
    if (!noLimit) {
        const { limit, page } = res;
        const maxPage = limit > 0 ? Math.floor(Math.min(limit * page, MAX_LIMIT) / limit) : MAX_LIMIT;
        res.page = Math.min(page, maxPage);
    } else {
        res.limit = MAX_LIMIT;
        res.page = 0;
    }

    //* returns.
    return res;
}

/**
 * common tools for transformer.
 * - extends the original `$T` in lemon-core.
 */
export const $T = {
    ..._T,
    /** clear white-spaces and trim */
    S2: <T extends string = string>(v?: any, def?: string): T => _T.S2(v, def, ' ').trim() as T,
    /** array string with clear white-spaces and trim */
    SS: <T extends string = string>(v?: any): T[] =>
        (v && Array.isArray(v) ? v : _T.SS(v)).map(v => _T.S2(v, '', ' ').trim() as T),
    /** convert to `boolean`. */
    B: (v: number | string | boolean, def?: 0 | 1 | boolean): boolean =>
        typeof v === 'number' || typeof v === 'string'
            ? Boolean($T.BN(v, typeof def === 'boolean' ? (def ? 1 : 0) : def))
            : Boolean(def),
    /** convert to boolean style number. */
    BN: <T extends number = number>(v: any, def?: 0 | 1): T => (v === undefined ? (def as T) : (_T.B(v, def) as T)),
    /** convert to `number` */
    N: (v: boolean | number | string, def?: number): number =>
        typeof v === 'boolean'
            ? v
                ? 1
                : 0
            : typeof v === 'number' || typeof v === 'string'
            ? _T.N(v, def)
            : undefined,
    /** convert to `float` w/ fixed(3) */
    F: (n: number | string) =>
        typeof n === 'string' || typeof n === 'number' ? parseFloat(Number(n).toFixed(3)) : undefined,
    /** cleanup if in undefined */
    clear: <T extends object>(N: T): T =>
        Object.entries(N).reduce((N, [k, v]) => {
            if (v !== undefined) N[k] = v;
            return N;
        }, {} as any),
    /** null to string */
    nul2str: <T extends string>(v: T | any): T => {
        if (v === undefined) return undefined;
        return _T.S(v ?? '') as T;
    },
    /**
     * find key in LUT table.
     */
    asLut: <T extends object>(
        key: string,
        $map: T,
        options?: { name?: string; throwable?: boolean; default?: string; errScope?: string } | string,
    ) => {
        const $opts = typeof options === 'string' ? { name: options } : options;
        const name = $opts?.name ?? 'name';
        const throwable = $opts?.throwable ?? true;
        const _def = $opts?.default ?? null;
        const errScope = $opts?.errScope ?? `asLut(${name ?? ''})`;
        //* check of empty.
        if (key === undefined) return undefined as keyof T;
        if (key === null) return _def as keyof T;

        //* check if key is defined.
        if (typeof $map[key as keyof T] === 'undefined') {
            //* lookup by value.
            const found = Object.entries($map).reduce((R, [k, v]) => {
                if (v === key) return k;
                return R;
            }, null);
            if (found !== null) return found as keyof T;

            //! throw or default
            if (!throwable) return _def as keyof T;
            if (errScope) throw new Error(`.${name}[${key}] is invalid key - ${errScope}`);
            throw new Error(`.${name}[${key}] is invalid!`);
        }
        return key as keyof T;
    },
    /**
     * pack as meta in general-type.
     */
    asMeta: <T extends GeneralItem = GeneralItem>(body: any, options?: { errScope?: string }): T => {
        const errScope = options?.errScope ?? '';
        if (!body) return {} as T;
        if (typeof body !== 'object') throw new Error(`@body (object) is required ${errScope}`.trim());
        const isVal = (v: any): v is number | string => typeof v === 'number' || typeof v === 'string';
        const res = Object.entries(body).reduce<GeneralItem>((R, [k, v]) => {
            if (isVal(v)) R[k] = v;
            else if (v && Array.isArray(v)) (R as any)[k] = v.filter(v => isVal(v));
            return R;
        }, {});
        return res as T;
    },
    /**
     * reduce aggregation from ES6
     * NOTE - 이거 반드시 최신꺼로 업데이트 필요함 @steve/250212
     */
    reduceAggr: ($aggr: any) =>
        Object.keys($aggr).reduce<{ [key: string]: { [key: string]: number } }>((M, key: string) => {
            const N: any = $aggr[key];
            if (key == 'doc_count' && typeof N == 'number') {
                M['doc_count'] = { total: N };
                return M;
            }
            M[key] = Object.keys(N).reduce<{ [key: string]: number }>((M, x) => {
                const Y = N[x];
                if (x == 'doc_count') M['total'] = $T.N(Y, 0);
                if (x == 'buckets' && Array.isArray(Y))
                    return Y.reduce((M, N) => {
                        if (typeof N?.key === 'string' && typeof N?.doc_count === 'number') {
                            M[N?.key] = N.doc_count;
                        }
                        return M;
                    }, M);
                return M;
            }, {});
            return M;
        }, {}),
};
