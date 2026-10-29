/**
 * `api-callback-loop-mock.spec.ts`
 * - end-to-end test of the loop test with lemon-core's local transport (`LOCAL_TRANSPORT=mock`, local mode):
 *   every kind goes `POST /callback/<kind>/loop` → the real lemon-core send side → an in-process Lambda record
 *   → the engine's `LambdaHandler.handle()` → the listener or `loop-recv` → the answer `{ mock: true, recv }`.
 * - no AWS: every AWS SDK client package (both `node_modules` trees) is replaced by one that throws on `send()`,
 *   and `fetch` refuses any call. the spec counts both and expects zero.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version.
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
import { realpathSync } from 'fs';
import path from 'path';

//! env for these tests; `undefined` deletes the name. set before lemon-core loads (the SQS service reads its endpoint once).
const ENV: { [key: string]: string | undefined } = {
    PROFILE: '',
    AWS_PROFILE: undefined,
    AWS_CONFIG_FILE: 'no-such-aws-file',
    AWS_SHARED_CREDENTIALS_FILE: 'no-such-aws-file',
    AWS_EC2_METADATA_DISABLED: 'true', //* a stray credential lookup fails fast (no instance-metadata wait).
    LOCAL_MODE: '1',
    LOCAL_TRANSPORT: 'mock',
    AWS_LAMBDA_FUNCTION_NAME: undefined,
    REPORT_ERROR_ARN: '',
    MY_SNS_ENDPOINT: 'arn:aws:sns:ap-northeast-2:000000000000:loop-mock-sns',
    MY_SQS_ENDPOINT: 'https://sqs.ap-northeast-2.amazonaws.com/000000000000/loop-mock-sqs',
};
//! set (or delete) each name of a map in `process.env`.
const setEnv = (M: { [key: string]: string | undefined }) =>
    Object.entries(M).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
const saved = Object.keys(ENV).reduce((M, k) => ({ ...M, [k]: process.env[k] }), {} as typeof ENV);
setEnv(ENV);

//! every SDK client call: `new` and `send()` are counted, and `send()` throws (nothing may reach AWS).
const sdkCalls: string[] = [];
//! the client and command names of each SDK package lemon-core loads.
const SDK_NAMES: { [pkg: string]: string[] } = {
    sns: ['SNSClient', 'PublishCommand'],
    sqs: [
        'SQSClient',
        'SendMessageCommand',
        'ReceiveMessageCommand',
        'DeleteMessageCommand',
        'GetQueueAttributesCommand',
    ],
    lambda: ['LambdaClient', 'InvokeCommand'],
    iam: ['IAMClient', 'GetUserCommand'],
    sts: ['STSClient', 'GetCallerIdentityCommand'],
    kms: ['KMSClient', 'DecryptCommand', 'EncryptCommand', 'SignCommand', 'VerifyCommand'],
};
//! a throwing SDK package: every `*Client` records `new` and `send()`, and `send()` throws.
const throwingSdk = (pkg: string) =>
    SDK_NAMES[pkg].reduce((M: any, name) => {
        M[name] = name.endsWith('Client')
            ? class {
                  public constructor() {
                      sdkCalls.push(`${pkg}:new`);
                  }
                  public send = async () => {
                      sdkCalls.push(`${pkg}:send`);
                      throw new Error(`AWS SDK ${pkg} must not be called in the mock spec`);
                  };
              }
            : class {
                  public constructor(public readonly input: any) {}
              };
        return M;
    }, {});
//! the SDK packages, resolved from this repo and from the linked lemon-core (lemon-core loads them lazily).
const LEMON_CORE = realpathSync(path.resolve(__dirname, '../../../node_modules/lemon-core'));
Object.keys(SDK_NAMES).forEach(pkg =>
    [__dirname, LEMON_CORE].forEach(from => {
        const file = require.resolve(`@aws-sdk/client-${pkg}`, { paths: [from] });
        jest.doMock(file, () => throwingSdk(pkg));
    }),
);

import $cores, { $localTransport, LambdaHandler, LambdaSNSHandler, LambdaSQSHandler, LocalDelivery } from 'lemon-core';
import request from 'supertest';
import { app } from '../../express';
import { CallbackAPIController } from './api-callback';
import { LOOP_KINDS, LoopTransports, loopLog, localRecv } from './loop';

//! a UUID v4 shape (as `crypto.randomUUID()`).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

//! the static `REPORT_ERROR` flags: off in this spec, so a failure never publishes an error report.
const REPORTERS: any[] = [LambdaHandler, LambdaSNSHandler, LambdaSQSHandler, $cores.cores.protocol.service.constructor];

//! main test body.
describe('callback loop test - local transport (mock)', () => {
    let reports: boolean[] = [];
    let info: jest.SpyInstance;
    let fetch: jest.Mock;
    const G: any = globalThis;
    const origFetch = G.fetch; //* `undefined` in the jest node environment.
    let drained: LocalDelivery[] = [];
    beforeEach(async () => {
        setEnv(ENV);
        reports = REPORTERS.map(C => C.REPORT_ERROR);
        REPORTERS.forEach(C => (C.REPORT_ERROR = false));
        info = jest.spyOn(loopLog, 'inf');
        //* any `fetch` (ex: a KMS call without the SDK) fails and is counted.
        fetch = G.fetch = jest.fn(async () => {
            throw new Error('fetch must not be called in the mock spec');
        });
        //* keep every drained delivery (the route drains them).
        drained = [];
        const drain = $localTransport.drain;
        jest.spyOn($localTransport, 'drain').mockImplementation(async () => {
            const list = await drain();
            drained.push(...list);
            return list;
        });
        sdkCalls.splice(0);
    });
    afterEach(() => {
        REPORTERS.forEach((C, i) => (C.REPORT_ERROR = reports[i]));
        G.fetch = origFetch;
        jest.restoreAllMocks();
    });
    afterAll(() => setEnv(saved));

    //* precondition: the transport is active, and the default SQS service points at this service's queue.
    it('should be active with this service endpoints', () => {
        expect($localTransport.isActive()).toBe(true);
        expect($cores.cores.aws.sqs.endpoint()).toEqual(ENV.MY_SQS_ENDPOINT);
    });

    //* every kind over express: 200, `mock: true`, one `recv` with the same loop id, no failed record, no AWS call.
    it('should run all 5 kinds end-to-end through express, recv exactly once per loop id', async () => {
        const loopIds: string[] = [];
        for (const kind of LOOP_KINDS) {
            const res = await request(app).post(`/callback/${kind}/loop`).send({ note: 'mock' });
            //* the text only on a failure (shows the error message).
            expect({ kind, status: res.status, text: res.status === 200 ? '' : res.text }).toEqual({
                kind,
                status: 200,
                text: '',
            });
            const { loopId } = res.body;
            expect(loopId).toMatch(UUID_RE);
            loopIds.push(loopId);
            expect(res.body).toMatchObject({ kind, loopId, mock: true });
            expect(res.body.recv).toEqual([{ kind, loopId, recvAt: expect.any(Number), hop: 1 }]);
            if (kind === 'protocol') expect(res.body.result).toMatchObject({ loopId, hop: 1 });
            else expect(res.body.messageId).toMatch(/^mock-/);
        }
        //* log lines: one send (` mock=1`) and exactly one recv per loop id.
        const lines: string[] = info.mock.calls.map(c => c[0]);
        LOOP_KINDS.forEach((kind, i) => {
            const id = loopIds[i];
            expect(lines.filter(l => l.startsWith(`[LOOP] send kind=${kind} loop=${id} `))).toEqual([
                expect.stringMatching(/ mock=1$/),
            ]);
            expect(lines.filter(l => l.startsWith(`[LOOP] recv kind=${kind} loop=${id} `)).length).toEqual(1);
        });
        expect(lines.filter(l => l.startsWith('[LOOP] bad'))).toEqual([]);
        //* deliveries: one per kind, no error, SQS records never failed.
        expect(drained.map(d => d.kind)).toEqual(['sns', 'sqs', 'protocol', 'sns', 'sqs']);
        expect(drained.filter(d => d.error)).toEqual([]);
        drained.filter(d => d.kind === 'sqs').forEach(d => expect(d.result).toEqual({ batchItemFailures: [] }));
        expect(localRecv.map.size).toEqual(0);
        //* nothing reached AWS.
        expect(sdkCalls).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
    });

    //* Lambda: the env is ignored, so the route answers as before (no `mock`, no `recv`, no ` mock=1`).
    it('should keep the Lambda behaviour when AWS_LAMBDA_FUNCTION_NAME is set', async () => {
        setEnv({ AWS_LAMBDA_FUNCTION_NAME: 'lemon-templates-api-dev-lambda' });
        const publish = jest.fn(async () => 'sns-mid-1');
        const $aws: LoopTransports = {
            sns: { publish },
            sqs: { sendMessage: jest.fn() },
            protocol: jest.fn(),
        };
        const api = new CallbackAPIController(undefined, () => $aws);
        const res: any = await api.doPostLoop('sns', {}, {}, { identity: { roles: ['admin'] } } as any);
        expect(Object.keys(res)).toEqual(['kind', 'loopId', 'messageId', 'sentAt']);
        expect(info.mock.calls.map(c => c[0])).toEqual([`[LOOP] send kind=sns loop=${res.loopId} message=sns-mid-1`]);
        expect(drained).toEqual([]);
        expect(sdkCalls).toEqual([]);
    });
});
