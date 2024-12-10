/**
 * `transformer.ts`
 * - transformer view to model
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { $T, GeneralItem } from 'lemon-core';

/**
 * internal data transformer.
 */
export const $X = {
    /** clear white-spaces and trim */
    S2: <T extends string = string>(v?: any): T => $T.S2(v, '', ' ').trim() as T,
    /** array string with clear white-spaces and trim */
    SS: <T extends string = string>(v?: any): T[] =>
        (v && Array.isArray(v) ? v : $T.SS(v)).map(v => $T.S2(v, '', ' ').trim() as T),
    /** convert to `boolean`. */
    B: (v: number): boolean => (typeof v === 'number' ? Boolean(v) : undefined),
    /** convert to boolean style number. */
    BN: <T extends number = number>(v: any): T => (v === undefined ? undefined : ($T.B(v) as T)),
    /** convert to `number` */
    N: (v: boolean | number): number =>
        typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? $T.N(v) : undefined,
    /** convert to `float` w/ fixed(3) */
    F: (n: number) => (typeof n === 'string' || typeof n === 'number' ? parseFloat(Number(n).toFixed(3)) : undefined),
    /** cleanup if in undefined */
    clear: <T extends object>(N: T): T =>
        Object.entries(N).reduce((N, [k, v]) => {
            if (v !== undefined) N[k] = v;
            return N;
        }, {} as any),
    /** null to string */
    nul2str: <T extends string>(v: T | any): T => {
        if (v === undefined) return undefined;
        return $T.S(v ?? '') as T;
    },
    /**
     * find key in LUT table.
     */
    asLut: <T extends object>(
        key: string,
        $map: T,
        options?: { name?: string; throwable?: boolean; default?: string } | string,
    ) => {
        const $opts = typeof options === 'string' ? { name: options } : options;
        const name = $opts?.name ?? 'name';
        const throwable = $opts?.throwable ?? true;
        const _def = $opts?.default ?? null;
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

/**
 * defualt export w/ instance
 */
export const $trans = {
    // test: new TestTransformer(),
};
