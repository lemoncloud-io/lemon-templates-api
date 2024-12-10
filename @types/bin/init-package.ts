/**
 * `bin/init-package.ts`
 * - init this `package.json` from parent's package.json
 * - copy properties { name, version, description, author }
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2023-01-19 optimized package.dependencies
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
//! override environment.
const $env = ((env: any) =>
    Object.assign(env, {
        LS: env.LS ?? '1', // line-silent in log
        LC: env.LC ?? '1', // line-colors in log
        TS: env.TS ?? '1', // timestamp in log
        NS: env.NS ?? 'SS', // name-space of models.
        STAGE: env.STAGE ?? 'prod',
        profile: env.profile ?? 'lemon',
        region: env.region ?? 'ap-northeast-2',
    }))(process.env);
const MODEL_VERSION = '1.0.2';

//! import statements
import AWS from 'aws-sdk';
import path from 'path';
import fs from 'fs';
import $engine, { $U, ConfigService, SimpleSet, _inf, _log } from 'lemon-core';
const NS = $U.NS('main', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * main handler spec
 */
interface MainFunc {
    (config?: ConfigService): Promise<string>;
}

/** ********************************************************************************************************************
 * MAIN FUNCTION
 *  *******************************************************************************************************************/
const loadJsonSync = (file: string): any => JSON.parse(fs.readFileSync(file).toString());
const saveJsonSync = (json: any, file?: string) => {
    const txt = JSON.stringify(json, null, 2);
    if (file) fs.writeFileSync(file, txt);
    return txt;
};

/**
 * make type's package.json.
 */
const makePackage = () => {
    const source = 'package.json';
    const target = path.normalize([__dirname, '..', 'package.json'].join('/'));
    _log(NS, `> target =`, target);

    // STEP.1 read the source package.
    const $src = loadJsonSync(source);
    _log(NS, `> src.name =`, $src.name);
    const { name, version, description, author } = $src;

    // STEP.2 read the target package.
    const $tar = loadJsonSync(target);
    _log(NS, `> tar.name =`, $tar.name);

    //* grap the dependencies to include in types
    const dependencies = Object.entries($src.dependencies).reduce<SimpleSet>((M, [k, v]) => {
        if (k == 'lemon-core') M['lemon-model'] = `^${MODEL_VERSION}`;
        else if (k == 'lemon-model') M['lemon-model'] = `${v}`;
        else if (k.startsWith('@lemoncloud/')) M[k] = `${v}`;
        return M;
    }, {});

    // STEP.3 replace properties.
    const $out = {
        ...$tar,
        name: `@lemoncloud/${name}`,
        version: `${version || $tar.version}`,
        description: `${description || $tar.description}`,
        author: `${author || $tar.author}`,
        dependencies,
    };

    // STPE.4 save(or overwrite) target
    const saved = saveJsonSync($out, target);
    _inf(NS, `> saved.name =`, saved?.split('\n').slice(1, 2).join(''));

    //! it will print in color.
    return $U.NS(`${name}#${version}`, 'green', 0, '');
};

/**
 * main handler....
 */
const main = async () => {
    _log(NS, `main()...`);
    _log(NS, `> path=`, __dirname);
    // FINAL. returns.
    return makePackage();
};

/** ********************************************************************************************************************
 * ENTRY FUNCTION
 *  *******************************************************************************************************************/
async function bootstrap(main: MainFunc) {
    // initialize AWS Config.
    const credentials = new AWS.SharedIniFileCredentials({ profile: $env.profile });
    AWS.config.credentials = credentials;
    AWS.config.region = $env.region;

    // initialize Lemon-Core config
    const config = $engine.cores.config.config;
    await config.init();

    // runs main function.
    return main(config);
}
//! run main.
bootstrap(main).then(res => console.info('Done:', res));
