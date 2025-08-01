/**
 * `engine.ts`
 * - main index to export
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-31 support ECMA 2016.
 * @date        2019-08-09 optimized with `lemon-core#1.0.1`
 * @date        2019-11-26 optimized with `lemon-core#2.0.0`
 * @date        2019-12-03 optimized with `lemon-core#2.0.3`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ********************************************************************************************************************
 *  start initializing `lemon-core` with global `process.env`
 ** ********************************************************************************************************************/
import $engine from 'lemon-core';

//! extract core handlers.
const $lambda = $engine.cores.lambda;
const $web = $lambda.web;
const $sqs = $lambda.sqs;
const $sns = $lambda.sns;
const $cron = $lambda.cron;

// Loading API Service of NextDecoder
import hello from './api/hello-api';
import crons from './api/crons-api';
import callback from './modules/callback/api-callback';
import search from './modules/search/api-search';
import mocks from './modules/mock/api-mocks';
import tests from './modules/mock/api-tests';
import sockets from './modules/sockets/api-sockets';

//! register sub handlers, and listeners.
$web.addController(hello);
$web.addController(callback);
$web.addController(search);
$web.addController(crons);
$web.addController(tests);
$web.addController(mocks);
$web.addController(sockets);

//! register cron listener
$cron.addListener((id, param, body, ctx) => crons.handleEvent(id, param, body, ctx));

//! export with used cores services.
export { $lambda, $web, $sqs, $sns };

//! default exports with lambda handler.
const lambda = async (e: any, c: any) => {
    //! handle via lambda-handler.
    return $lambda.lambda.handle(e, c);
};
export default { $engine, lambda };
