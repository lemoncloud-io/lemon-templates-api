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
import { $U, _inf, _log, _err, NextContext } from 'lemon-core';
import { $T } from 'lemon-core';
import { ModelType } from './backend-types';
import { BackendService } from './backend-service';
import { MyCoreProxy } from 'lemon-core';
import { CallbackManagerProxy } from '../modules/callback/proxy';
import { MockManagerProxy, TestManagerProxy } from '../modules/mock/proxy';
const NS = $U.NS('backend', 'blue'); // NAMESPACE TO BE PRINTED.

/**
 * class: `BackendProxy`
 * - manager proxy to handle micro-transaction.
 */
export class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    public readonly callback: CallbackManagerProxy;
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

        this.callback = new CallbackManagerProxy(this, service.$callback);
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

    /**
     * v5 transition: a v4 internal caller still sends `domain: 'localhost'` without a role claim.
     * - accept it only when the context is an internal protocol call (`channel: 'internal'`, `isInternalAdmin()`);
     *   an external request (`channel: 'external'`) never gets admin from `domain`.
     * - v5 callers claim the role (`asAdminContext()`); remove this when every caller runs v5.
     */
    public hasAdminRole(role?: string, options?: { errScope?: string; context?: NextContext }): boolean {
        //* v5 admin first: local mode, signed key, or the role claim.
        if (super.hasAdminRole(role, options)) return true;
        //* v4 internal caller in transition: `domain: 'localhost'` only on an internal protocol call.
        const context = options?.context ?? this.context;
        return context?.domain === 'localhost' && this.isInternalAdmin(null, context);
    }

    /**
     * v5 D112: gate of an internal delegation call that keeps the caller identity
     * (relay `internal`, local server `local`).
     * - an administrative action uses `hasAdminRole()` and the caller `asAdminContext()` instead.
     * - never gate on `context.domain`.
     */
    public isInternalCall(context?: NextContext): boolean {
        //* only the channel set by lemon-core decides; an external web request is `external`.
        const channel = (context ?? this.context)?.channel;
        return channel === 'internal' || channel === 'local';
    }
}
