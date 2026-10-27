/**
 * `index.ts`
 * - main index to export
 *
 * **NOTE**
 * - DO `NOT EXPORT` ANY ADDITIONALS DUE TO TIME OF ENGINE INITIALIZER.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-31 support ECMA 2016.
 * @date        2019-08-09 optimized with `lemon-core#1.1.1`
 * @date        2019-11-26 optimized with `lemon-core#2.0.0`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
/** ********************************************************************************************************************
 *  Loading API Services.
 ** ********************************************************************************************************************/
/**
 * start engine intialize, and returns.
 */
export const engine = () => {
    const $engine = require('./engine').default;
    return $engine;
};

/**
 * start load express, and returns
 */
export const express = () => {
    const $express = require('./express').default;
    return $express;
};

/** ********************************************************************************************************************
 *  MAIN RUNNER
 *
 * # Usage
 * - required to run `$ npm run express.lemon`
 *
 * ```sh
 * # run express in local
 * $ node .
 * ```
 ** *******************************************************************************************************************/
if (typeof require !== 'undefined' && require.main === module) {
    const $express = express();
    $express.createServer();
}
