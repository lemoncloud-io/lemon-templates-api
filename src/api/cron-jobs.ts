/**
 * `cron-jobs.ts`
 * - definitions of crons
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2021-11-08 initial version
 *
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, waited, _err, _inf, _log } from 'lemon-core';
import { CronEntry } from './crons-api';
const NS = $U.NS('jobs', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * list of cron jobs
 */
export const CRON_JOBS: { [id: string]: CronEntry } = {
    hello: {
        name: 'hello',
        desc: 'on Monday 00:00 => export latest race results',
        check: (w, d, h, m) => d === 1 && h === 0 && m === 0,
        execute: async thiz => {
            _log(NS, `hello()`);
            const hello = thiz.hello();
            await waited(750);
            return { hello };
        },
    },
    // metrics: {
    //     name: 'metrics-report-daily',
    //     desc: 'triggered at 10:20 am everyday',
    //     check: (w, d, h, m) => h == 10 && m == 20,
    //     execute: async (thiz, $ctx) => {
    //         return accounts.getAccountsReportMetrics('0', null, null, $ctx);
    //     },
    // },
};
