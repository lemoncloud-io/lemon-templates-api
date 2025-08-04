/**
 * Basic Configuration.
 * - 기본 환경 설정으로, 각 AWS Profile 별로 적용할 serverless custom 환경 설정.
 * - 각 profile별로 주요 변수(특히 환결 설정 파일)를 설정함.
 *
 * 참고: https://velog.io/@doondoony/Serverless-Framework-serverless.yml-%EC%84%A4%EC%A0%95-%EC%A0%95%EB%B3%B4-%EC%88%A8%EA%B8%B0%EA%B8%B0-2hjmsx7nal
 *
 *
 * @param {*} serverless        see `node_modules/serverless/lib/Serverless.js`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-07-19 initial version
 * @date        2019-12-19 optimized for `lemon-core#v2`
 * @date        2022-05-24 optimized for `lemon-core#3.1.1` w/ serverless 3.16
 * @date        2022-08-22 optimized for `lemon-core#3.1.2` w/ `nodejs18`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
 const CONF = (serverless) => {
    // console.log('serverless=', serverless);
    console.log('Loading config settings...');
    return {
        lemon: {
            name: 'lemon-app',
            runtime: 'nodejs22.x',                              // Powered by the V8 JavaScript Engine (used in Chromium)
            region: 'ap-northeast-2',
            env: 'lemon.yml',                                   // environment file
            kmsKey: '*',                                        // KMS key-id to encrypt/decrypt or verify token.
        },
        ssocio: {
            name: 'ssocio-app',
            runtime: 'nodejs22.x',                              // Powered by the V8 JavaScript Engine (used in Chromium)
            region: 'ap-northeast-2',
            env: 'ssocio.yml',                                  // environment file
            //WARN! lambda를 VPC에서 이용할경우 NAT와 VPCE 등 네트워크 설정 구성 필요함!!! (refer to `lemon-hello-api`)
            securityGroupIds: ['sg-0b0fb4d4bd885c7cd'],         // securityGroupIds `lemon-micro-private`
            subnetIds: ['subnet-0fcfaad965a2dc997', 'subnet-03a5987eac7caa520'], // subnetIds `subnet-private-2a/2c`
            kmsKey: '*',                                        // KMS key-id to encrypt/decrypt or verify token.
        },
        none: {
            name: 'none-app',
            runtime: 'nodejs22.x',                              // Powered by the V8 JavaScript Engine (used in Chromium)
            region: 'ap-northeast-2',
            env: 'none.yml',                                    // environment file
            //WARN! lambda를 VPC에서 이용할경우 NAT와 VPCE 등 네트워크 설정 구성 필요함!!! (refer to `lemon-hello-api`)
            securityGroupIds: undefined,                        // securityGroupIds in VPC
            subnetIds: undefined,                               // subnetIds in VPC
            kmsKey: undefined,                                  // KMS key-id to encrypt/decrypt or verify token.
        },
    };
}

//! export
exports = module.exports = {CONF}
