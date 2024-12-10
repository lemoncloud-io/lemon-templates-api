/**
 * `backend-proxy.ts`
 * - proxy of backend managers
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-08-29 initial version.
 *
 * @copyright   (C) lemoncloud.io 2022 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, $T, _inf, _log, _err, NextContext } from 'lemon-core';
import { ModelType } from './backend-types';
import { BackendService } from './backend-service';
import { MyCoreProxy } from '../cores/abstract-services';
import { MockManagerProxy, TestManagerProxy } from '../modules/mock/proxy';
const NS = $U.NS('backend', 'blue'); // NAMESPACE TO BE PRINTED.

/**
 * class: `BackendProxy`
 * - manager proxy to handle micro-transaction.
 */
export class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    public readonly test: TestManagerProxy;
    public readonly mock: MockManagerProxy;

    /**
     * constructor of proxy.
     * @param context the current request context
     * @param service the main backend service
     */
    public constructor(context: NextContext, service: BackendService) {
        super(context, service);
        _log(NS, `BackendProxy(${service.NS})..`);

        this.test = new TestManagerProxy(this, service.$test);
        this.mock = new MockManagerProxy(this, service.$mock);
    }

    /**
     * make indexed id w/ parent-id
     */
    public asIndexId = (parent: string, i: number, delim = ':') => {
        if (typeof i !== 'number' || i < 0) throw new Error(`@i[${i}] (number) is invalid - asIndexId(${parent})`);
        return `${parent || ''}${delim}${i}`;
    };

    /**
     * pull out parent-id
     */
    public asParentIndexId = (id: string, delim = ':') => {
        const parts = id.split(delim);
        if (parts.length === 1) {
            return '';
        } else {
            parts.pop();
            return parts.join(delim);
        }
    };

    /**
     * verify and convert as date (YYYYMMDD)
     */
    public asDate = (s: string, delimJoin = '') => {
        if (!/^[0-9]{4}\-?[01][0-9]\-?[0-3][0-9]$/.test(s)) throw new Error(`@date[${s}] is invalid format!`);
        return s.split('-').join(delimJoin);
    };

    /**
     * if in string -> must be `id`, or index number.
     */
    public asIdOrIndex = (s: string | number, maxLen = 2) => {
        if (typeof s === 'number') return s;
        if (s === '0' || s === null || s === undefined || s === '') return 0;
        if (typeof s === 'string' && s.length <= maxLen && /^[1-9][0-9]{0,5}$/.test(s)) return $T.N(s);
        return s;
    };
}
