/**
 * `crons-api.ts`
 * - common cron handler
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2021-11-08 initial version
 * @date        2022-01-18 moved to `cron-jobs`
 *
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { $U, _err, _inf, _log } from 'lemon-core';
import {
    GETERR,
    GETERR$,
    CronParam,
    NextHandler,
    NextContext,
    CronNextHandler,
    doReportError,
    GeneralWEBController,
} from 'lemon-core';
import { $slack, $T, my_parrallel } from 'lemon-core';
import { CRON_JOBS } from './cron-jobs';
// import searches from './search-api';
const NS = $U.NS('crons', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * weeks in korean.
 */
export type WEEKS = '일' | '월' | '화' | '수' | '목' | '금' | '토';

/**
 * type: CronEntry
 */
export interface CronEntry {
    /**
     * name of cron
     */
    name: string;
    /**
     * (optional) description.
     */
    desc?: string;
    /**
     * (optional) do not report in slack.
     */
    silent?: boolean;
    /**
     * check if to run execute
     */
    check: (w: WEEKS, d: number, h: number, m: number, hm: number) => boolean;
    /**
     * main execute function.
     */
    execute: (
        thiz: CronAPIController,
        $ctx: NextContext,
        $param: { stage?: '' | 'prod'; param: any; body: any },
        time: { W: WEEKS },
    ) => Promise<any>;
}

/**
 * class: `CronAPIController`.
 */
export class CronAPIController extends GeneralWEBController {
    /**
     * constructor
     */
    public constructor() {
        super('crons');
        _log(NS, `CronAPIController()...`);
    }

    /**
     * name of this resource
     */
    public hello = () => `cron-api-controller`;

    /* eslint-disable prettier/prettier */
    /* eslint-enable prettier/prettier */

    /**
     * handle cron event
     */
    public handleEvent: CronNextHandler = async (id, param, body, context) =>
        this.handleNext(id, param, body, context)
            .catch(e => doReportError(e, context, null, { id, param, body }))
            .then(() => undefined);

    /**
     * handle the next event
     *
     * @returns object only if id is valid.
     */
    public handleNext: NextHandler<CronParam, { id?: string; data?: any }> = async (id, param, body, context) => {
        _log(NS, `handleEvent(${id}) ...`);
        param && _log(NS, `> param =`, $U.json(param));
        body && _log(NS, `> body =`, $U.json(body));
        id = id === '0' || id === '!' ? '' : $T.S(id); // '!' is expected. (see lemon-core)
        const $cron = id ? CRON_JOBS[id] : null;
        if (id && !$cron) throw new Error(`404 NOT FOUND - id:${id}`);

        // parse cron params
        const silent = !!$T.B((param as any)?.silent, (param as any)?.silent === '' ? 1 : 0);
        const cronName = $T.S(param?.name);
        const stage = $U.env('STAGE', '').startsWith('prod') ? 'prod' : '';
        const $prf = $T.perf(); // starting of processing

        // handle cron
        const ts = $U.ts();
        const dt = $U.dt(ts);
        const [D, T] = ts.split(' ', 2);
        const [y, M, d] = D.split('-').map(d => $U.N(d, 0));
        const [h, m, s] = T.split(':').map(d => $U.N(d, 0));
        const hm = h * 100 + m;
        const w = dt.getDay(); // day-of-week. [S,M,T,W,T,F,S]
        const W = '일,월,화,수,목,금,토,일'.split(',')[w] as WEEKS;
        _log(NS, `> y,M,d =`, [y, M, d, W]);
        _log(NS, `> h,m,s =`, [h, m, s]);
        //! find jobs to execute.
        const jobs = id
            ? [{ ...$cron, silent, id }]
            : Object.entries(CRON_JOBS)
                  .map(([id, v]) => ({ ...v, id }))
                  .filter(N => N.check(W, d, h, m, hm));
        //! run all jobs...........
        const parallel = 1;
        const results = await my_parrallel(
            jobs,
            async J =>
                J.execute(this, context, { stage, param, body }, { W })
                    .then(R => {
                        _inf(NS, `> CRON[${J.name}].res =`, $U.json(R));
                        return { id: J.id, name: J.name, result: R, error: null as string };
                    })
                    .catch(async e => {
                        _err(NS, `> CRON[${J.name}].err =`, $U.json(GETERR$(e)));
                        await doReportError(e, context, null, { cron: J.name, param, ts });
                        return { id: J.id, name: J.name, error: GETERR(e) };
                    }),
            parallel,
        );
        const took = $prf.took(); // ends of processing.

        // report into slack. (if not silent)
        if (jobs.filter(J => !J.silent).length > 0) {
            const total = results?.length;
            const success = results.filter(N => !N.error).length;
            const failed = results.filter(N => !!N.error).length;
            await $slack(
                `작업[\`${stage}/${cronName}\`] 완료 T(S/F): \`${total}(${success}/${failed})\` took:\`${took}\`s.`,
                { ts, dt, w, W, results, took },
                null,
                { scope: 'cron' },
            );
        }

        // returns 1st elements.
        return { id, name: $cron?.name, description: $cron?.desc, data: results[0], took };
    };

    /**
     * run(trigger) cron job by id.
     *
     * ```sh
     * $ http POST ':8888/crons/hello/run?silent'
     */
    public postCronsRun: NextHandler = async (id, param, body, $ctx) => {
        _log(NS, `postCronsRun(${id})..`);
        id = id === '0' ? '' : $T.S(id);
        param && _log(NS, `> param[${id}] =`, $U.json(param));
        body && _log(NS, `> body[${id}] =`, $U.json(body));
        $ctx && _log(NS, `> context[${id}] =`, $U.json($ctx));
        if (!id) throw new Error(`@id is required - crons`);
        // STEP.1 find the target cron-job.
        const camelCased = (s: string) => s.replace(/-([a-z])/g, g => g[1].toUpperCase());
        const id2 = camelCased(id);
        const cronId = CRON_JOBS[id] ? id : CRON_JOBS[id2] ? id2 : '';
        if (!cronId) throw new Error(`404 NOT FOUND - cron-id:${id}`);
        // STEP.2 pass to handleEvent.
        const name = $T.S(param?.name, cronId);
        return this.handleNext(cronId, { ...param, name }, body, $ctx);
    };
}

// export as default instance
export default new CronAPIController();
