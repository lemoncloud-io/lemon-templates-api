/**
 * `api-callback-loop.spec.ts`
 * - unit test of the loop test in the callback module (`loop.ts` + `doPostLoop()`/`doPostLoopRecv()`).
 * - no AWS: every send-side service is mocked; the engine tests feed synthetic Lambda events to `$sns`/`$sqs`,
 *   and the protocol loop runs in-process through `$web.handleProtocol()`.
 * - a separate spec: it does not import `backend-proxy.spec` (pre-existing TS2345), so it runs on its own.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (SNS/SQS/protocol loop test).
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
import $cores, { GETERR, LambdaHandler, LambdaSNSHandler, LambdaSQSHandler } from 'lemon-core';
import request from 'supertest';
import { app } from '../../express';
import { $sns, $sqs, $web } from '../../engine';
import { loadSample } from '../../test-helpers/contexts.spec';
import { CallbackAPIController } from './api-callback';
import { LoopTransports, onLoopMessage, onLoopRecv, loopLog, isNestedTrigger, sourcePath } from './loop';
import { LOOP_SUBJECT, RECV_CMD } from './loop';

//! a UUID v4 shape (as `crypto.randomUUID()`).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

//! a fixed loop id for the receiver tests.
const LOOP_ID = '0b5c3f7e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

//! the recv line of a kind (latency varies).
const RECV_RE = (kind: string, tail = '') =>
    new RegExp(`^\\[LOOP\\] recv kind=${kind} loop=${LOOP_ID} latency=\\d+ms${tail}$`);

//! env for these tests; `undefined` deletes the name (same pattern as `fields-admin.spec.ts`).
const NO_FILE = 'no-such-aws-file';
const ENV: { [key: string]: string | undefined } = {
    PROFILE: '',
    AWS_PROFILE: undefined,
    AWS_CONFIG_FILE: NO_FILE,
    AWS_SHARED_CREDENTIALS_FILE: NO_FILE,
    LOCAL_MODE: undefined,
    AWS_LAMBDA_FUNCTION_NAME: undefined,
};

//! set (or delete) each name of a map in `process.env`.
const setEnv = (M: { [key: string]: string | undefined }) =>
    Object.entries(M).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));

//! the static `REPORT_ERROR` flags: off in this spec, so a failure never publishes an error report (no AWS).
const REPORTERS: any[] = [LambdaHandler, LambdaSNSHandler, LambdaSQSHandler, $cores.cores.protocol.service.constructor];

//! fake transports that record each call (`protocol` records the context and the target too).
const fakeTransports = (onExecute?: (ctx: any, service: string, body: any) => any) => {
    const publish = jest.fn<Promise<string>, [string, string, any]>(async () => 'sns-mid-1');
    const sendMessage = jest.fn<Promise<string>, [any, any?]>(async () => 'sqs-mid-1');
    const execute = jest.fn();
    const protocol = jest.fn((context: any, service: string) => ({
        execute: async (param?: any, body?: any, mode?: string) => {
            execute(param, body, mode);
            return onExecute ? onExecute(context, service, body) : { loopId: body?.loopId, recvAt: 1, hop: body?.hop };
        },
    }));
    const $aws: LoopTransports = { sns: { publish }, sqs: { sendMessage }, protocol };
    return { publish, sendMessage, protocol, execute, provider: () => $aws };
};

//! spies on every shared send-side service of lemon-core (resolved, so nothing reaches AWS).
const sendSpies = () => {
    const proto: any = $cores.cores.protocol.service;
    return [
        jest.spyOn($cores.cores.aws.sns, 'publish').mockResolvedValue('sns-mid-x'),
        jest.spyOn($cores.cores.aws.sqs, 'sendMessage').mockResolvedValue('sqs-mid-x'),
        jest.spyOn(proto, 'execute').mockResolvedValue({}),
        jest.spyOn(proto, 'notify').mockResolvedValue('n'),
        jest.spyOn(proto, 'enqueue').mockResolvedValue('q'),
        jest.spyOn(proto, 'broadcast').mockResolvedValue('b'),
    ];
};

//! total calls of the given spies (and fake transports).
const calls = (...fns: jest.Mock[] | jest.SpyInstance[]) => (fns as any[]).reduce((n, f) => n + f.mock.calls.length, 0);

//! a context with `identity.roles` only, like a direct invoke with `--identity '{"roles":["admin"]}'`.
const rolesContext = (roles: string[], more?: any): any => ({ identity: { roles }, ...more });

//! a synthetic SNS Lambda event with one record (payload as the `Message` JSON text).
const snsEvent = (subject: string, payload: any) => ({
    Records: [
        {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            Sns: { Type: 'Notification', Subject: subject, Message: JSON.stringify(payload), MessageAttributes: {} },
        },
    ],
});

//! a synthetic SQS Lambda event with one record (attributes as string values).
const sqsEvent = (attr: { [key: string]: string }, payload: any) => ({
    Records: [
        {
            messageId: 'm-1',
            receiptHandle: 'h-1',
            body: JSON.stringify(payload),
            attributes: {},
            messageAttributes: Object.entries(attr).reduce(
                (M: any, [k, v]) => ({ ...M, [k]: { dataType: 'String', stringValue: v } }),
                {},
            ),
            eventSource: 'aws:sqs',
        },
    ],
});

//! a good message of a kind.
const message = (kind: string, more?: any) => ({ loop: kind, loopId: LOOP_ID, sentAt: Date.now(), hop: 1, ...more });

//! main test body.
describe('callback loop test', () => {
    //* save the env and the report flags before each test, then apply `ENV` (not local, unless a test sets it).
    let saved: { [key: string]: string | undefined } = {};
    let reports: boolean[] = [];
    let info: jest.SpyInstance;
    beforeEach(() => {
        saved = Object.keys(ENV).reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
        setEnv(ENV);
        reports = REPORTERS.map(C => C.REPORT_ERROR);
        REPORTERS.forEach(C => (C.REPORT_ERROR = false));
        info = jest.spyOn(loopLog, 'inf');
    });
    //* restore the env, the report flags and the spies after each test.
    afterEach(() => {
        setEnv(saved);
        REPORTERS.forEach((C, i) => (C.REPORT_ERROR = reports[i]));
        jest.restoreAllMocks();
    });

    //! ---------------------------------------------------------------------------------------------------------------
    //! trigger: `POST /callback/<kind>/loop`
    //! ---------------------------------------------------------------------------------------------------------------

    //* the admin gate: 403 for a non-admin context, before any send.
    it('should deny POST /callback/<kind>/loop without admin role', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const deny = (id: string) => `403 NOT ALLOWED - only for admin @doPostLoop(callback/${id})`;
        expect(await api.doPostLoop('sns', {}, {}, rolesContext(['user'])).catch(GETERR)).toEqual(deny('sns'));
        expect(await api.doPostLoop('sqs', {}, {}, loadSample('public').context).catch(GETERR)).toEqual(deny('sqs'));
        expect(await api.doPostLoop('protocol', {}, {}, loadSample('session').context).catch(GETERR)).toEqual(
            deny('protocol'),
        );
        expect(calls(T.publish, T.sendMessage, T.protocol)).toEqual(0);
    });

    //* the admin gate over express: an external request (not local) answers 403.
    it('should deny POST /callback/sns/loop over express without LOCAL_MODE', async () => {
        const spies = sendSpies();
        const res = await request(app).post('/callback/sns/loop').send({});
        expect(res.status).toEqual(403);
        expect(res.text).toEqual('403 NOT ALLOWED - only for admin @doPostLoop(callback/sns)');
        expect(calls(...spies)).toEqual(0);
    });

    //* unknown kind: 404 for an admin.
    it('should answer 404 for an unknown kind', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const admin = rolesContext(['admin']);
        expect(await api.doPostLoop('kafka', {}, {}, admin).catch(GETERR)).toEqual(
            '404 NOT FOUND - callback/kafka/loop',
        );
        expect(await api.doPostLoop('', {}, {}, admin).catch(GETERR)).toEqual('404 NOT FOUND - callback//loop');
        expect(calls(T.publish, T.sendMessage, T.protocol)).toEqual(0);
    });

    //* SNS: publish('', 'x-loop-test', payload) once, and the response shape.
    it('should publish the SNS loop payload', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const t0 = Date.now();
        const res: any = await api.doPostLoop('sns', {}, { note: 'hi' }, rolesContext(['admin']));
        expect(Object.keys(res)).toEqual(['kind', 'loopId', 'messageId', 'sentAt']);
        expect(res).toMatchObject({ kind: 'sns', messageId: 'sns-mid-1' });
        expect(res.loopId).toMatch(UUID_RE);
        expect(res.sentAt).toBeGreaterThanOrEqual(t0);
        expect(res.sentAt).toBeLessThanOrEqual(Date.now());
        expect(T.publish).toHaveBeenCalledTimes(1);
        expect(T.publish).toHaveBeenCalledWith('', LOOP_SUBJECT, {
            loop: 'sns',
            loopId: res.loopId,
            sentAt: res.sentAt,
            hop: 1,
            note: 'hi',
        });
        expect(calls(T.sendMessage, T.protocol)).toEqual(0);
        expect(info.mock.calls.map(c => c[0])).toEqual([`[LOOP] send kind=sns loop=${res.loopId} message=sns-mid-1`]);
    });

    //* SQS: sendMessage(payload, { Subject, loop, loopId }) once, and the response shape.
    it('should send the SQS loop payload', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const res: any = await api.doPostLoop('sqs', {}, null, rolesContext(['admin']));
        expect(Object.keys(res)).toEqual(['kind', 'loopId', 'messageId', 'sentAt']);
        expect(res).toMatchObject({ kind: 'sqs', messageId: 'sqs-mid-1' });
        expect(res.loopId).toMatch(UUID_RE);
        expect(T.sendMessage).toHaveBeenCalledTimes(1);
        expect(T.sendMessage).toHaveBeenCalledWith(
            { loop: 'sqs', loopId: res.loopId, sentAt: res.sentAt, hop: 1 },
            { Subject: LOOP_SUBJECT, loop: 'sqs', loopId: res.loopId },
        );
        expect(calls(T.publish, T.protocol)).toEqual(0);
        expect(info.mock.calls.map(c => c[0])).toEqual([`[LOOP] send kind=sqs loop=${res.loopId} message=sqs-mid-1`]);
    });

    //* protocol: execute() once to `//self/callback/<loopId>/loop-recv` with the payload as body, admin, depth + 1.
    it('should execute the protocol loop to //self/callback/<loopId>/loop-recv', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const ctx = rolesContext(['admin'], { requestId: 'r-1', source: 'api://x@self-api/callback/protocol/loop#1' });
        const res: any = await api.doPostLoop('protocol', {}, {}, ctx);
        expect(Object.keys(res)).toEqual(['kind', 'loopId', 'sentAt', 'result']);
        expect(res.kind).toEqual('protocol');
        expect(res.loopId).toMatch(UUID_RE);
        expect(res.result).toEqual({ loopId: res.loopId, recvAt: 1, hop: 1 });
        expect(T.protocol).toHaveBeenCalledTimes(1);
        const [context, service] = T.protocol.mock.calls[0];
        expect(service).toEqual(`//self/callback/${res.loopId}/${RECV_CMD}`);
        expect(context).toMatchObject({ requestId: 'r-1', depth: 1, identity: { roles: ['admin'] } });
        expect(T.execute).toHaveBeenCalledWith(
            null,
            { loop: 'protocol', loopId: res.loopId, sentAt: res.sentAt, hop: 1 },
            'POST',
        );
        expect(calls(T.publish, T.sendMessage)).toEqual(0);
        const lines = info.mock.calls.map(c => c[0]);
        expect(lines[0]).toEqual(`[LOOP] send kind=protocol loop=${res.loopId} message=-`);
        expect(lines[1]).toMatch(new RegExp(`^\\[LOOP\\] done kind=protocol loop=${res.loopId} rtt=\\d+ms$`));
        expect(lines.length).toEqual(2);
    });

    //* protocol with the real `$protocol()`: the protocol param targets callback/<loopId>/loop-recv (POST, body).
    it('should build the protocol param with the real $protocol()', async () => {
        const spies = sendSpies();
        const execute = spies[2];
        const api = new CallbackAPIController();
        const res: any = await api.doPostLoop('protocol', {}, {}, rolesContext(['admin']));
        expect(execute).toHaveBeenCalledTimes(1);
        const param: any = execute.mock.calls[0][0];
        expect(param).toMatchObject({ mode: 'POST', type: 'callback', id: res.loopId, cmd: RECV_CMD });
        expect(param.body).toEqual({ loop: 'protocol', loopId: res.loopId, sentAt: res.sentAt, hop: 1 });
        expect(param.context).toMatchObject({ depth: 1, identity: { roles: ['admin'] } });
        expect(calls(...spies)).toEqual(1);
    });

    //* the optional note: only a string, trimmed, capped at 100 chars.
    it('should cap the note at 100 chars and drop a non-string note', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        await api.doPostLoop('sns', {}, { note: `  ${'x'.repeat(150)}  ` }, rolesContext(['admin']));
        expect(T.publish.mock.calls[0][2].note).toEqual('x'.repeat(100));
        await api.doPostLoop('sns', {}, { note: { a: 1 } }, rolesContext(['admin']));
        expect('note' in T.publish.mock.calls[1][2]).toBe(false);
    });

    //* each request has its own loop id.
    it('should make a new loop id per request', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const a: any = await api.doPostLoop('sns', {}, {}, rolesContext(['admin']));
        const b: any = await api.doPostLoop('sns', {}, {}, rolesContext(['admin']));
        expect(a.loopId).not.toEqual(b.loopId);
    });

    //* routing over express in local mode: each kind reaches `doPostLoop()` (default lemon-core services, mocked).
    it('should route POST /callback/<kind>/loop over express in local mode', async () => {
        process.env.LOCAL_MODE = '1';
        const spies = sendSpies();
        const [publish, send, execute] = spies;
        const r1 = await request(app).post('/callback/sns/loop').send({ note: 'n' });
        expect(r1.status).toEqual(200);
        expect(r1.body).toMatchObject({ kind: 'sns', messageId: 'sns-mid-x' });
        expect(publish).toHaveBeenCalledWith('', LOOP_SUBJECT, expect.objectContaining({ loop: 'sns', note: 'n' }));
        const r2 = await request(app).post('/callback/sqs/loop').send({});
        expect(r2.status).toEqual(200);
        expect(r2.body).toMatchObject({ kind: 'sqs', messageId: 'sqs-mid-x' });
        const r3 = await request(app).post('/callback/protocol/loop').send({});
        expect(r3.status).toEqual(200);
        expect(r3.body).toMatchObject({ kind: 'protocol', result: {} });
        expect([publish, send, execute].map(f => f.mock.calls.length)).toEqual([1, 1, 1]);
    });

    //! ---------------------------------------------------------------------------------------------------------------
    //! guard 2: a nested trigger (re-entry through the protocol channel) is refused
    //! ---------------------------------------------------------------------------------------------------------------

    //* depth > 0, or a source path of another route: `400 INVALID LOOP - nested trigger`, no send.
    it('should refuse a nested trigger with 400 (guard 2)', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const nested = '400 INVALID LOOP - nested trigger';
        for (const kind of ['sns', 'sqs', 'protocol']) {
            const deep = rolesContext(['admin'], { depth: 1 });
            expect(await api.doPostLoop(kind, {}, {}, deep).catch(GETERR)).toEqual(nested);
            const other = rolesContext(['admin'], { source: 'api://1@self-api/callback/protocol/loop#1' });
            if (kind !== 'protocol') expect(await api.doPostLoop(kind, {}, {}, other).catch(GETERR)).toEqual(nested);
            const recv = rolesContext(['admin'], { source: `api://1@self-api/callback/${LOOP_ID}/${RECV_CMD}#1` });
            expect(await api.doPostLoop(kind, {}, {}, recv).catch(GETERR)).toEqual(nested);
        }
        expect(calls(T.publish, T.sendMessage, T.protocol)).toEqual(0);
        //* a direct request: its own route as source (lemon-core `packContext()`), or no path at all.
        expect(isNestedTrigger({ source: 'api://1@self-api/callback/sns/loop#1' }, 'callback', 'sns')).toBe(false);
        expect(isNestedTrigger({ source: 'api://0008540000@lemon-hello-api#2.12.24a' }, 'callback', 'sns')).toBe(false);
        expect(isNestedTrigger({}, 'callback', 'sns')).toBe(false);
        expect(sourcePath('api://a@b-api/x/y/z#1')).toEqual('/x/y/z');
        expect(sourcePath(undefined)).toEqual('');
    });

    //* in-process: a protocol send that lands on a trigger route is refused by the receiving handler (guard 2).
    it('should refuse a trigger re-entered through $web.handleProtocol() (guard 2)', async () => {
        const T = fakeTransports((ctx, service, body) =>
            $web.handleProtocol({ mode: 'POST', type: 'callback', id: 'sns', cmd: 'loop', body, context: ctx } as any),
        );
        const api = new CallbackAPIController(undefined, T.provider);
        const err = await api.doPostLoop('protocol', {}, {}, rolesContext(['admin'])).catch(GETERR);
        expect(err).toEqual('400 INVALID LOOP - nested trigger');
        expect(calls(T.publish, T.sendMessage)).toEqual(0);
        expect(T.protocol).toHaveBeenCalledTimes(1);
    });

    //! ---------------------------------------------------------------------------------------------------------------
    //! protocol receiver: `POST /callback/<loopId>/loop-recv`
    //! ---------------------------------------------------------------------------------------------------------------

    //* in-process full loop: trigger → execute → `$web.handleProtocol()` → receiver → result back to the trigger.
    it('should run the protocol loop in-process through $web.handleProtocol()', async () => {
        const spies = sendSpies();
        const T = fakeTransports((ctx, service, body) => {
            const [, , , , id, cmd] = service.split('/'); // '//self/callback/<id>/<cmd>' → ['', '', self, callback, id, cmd]
            return $web.handleProtocol({ mode: 'POST', type: 'callback', id, cmd, body, context: ctx } as any);
        });
        const api = new CallbackAPIController(undefined, T.provider);
        const res: any = await api.doPostLoop('protocol', {}, {}, rolesContext(['user', 'admin']));
        expect(res.result).toMatchObject({ loopId: res.loopId, hop: 1 });
        expect(res.result.recvAt).toBeGreaterThanOrEqual(res.sentAt);
        const lines = info.mock.calls.map(c => c[0]);
        expect(lines[0]).toEqual(`[LOOP] send kind=protocol loop=${res.loopId} message=-`);
        expect(lines[1]).toMatch(new RegExp(`^\\[LOOP\\] recv kind=protocol loop=${res.loopId} latency=\\d+ms hop=1$`));
        expect(lines[2]).toMatch(new RegExp(`^\\[LOOP\\] done kind=protocol loop=${res.loopId} rtt=\\d+ms$`));
        //* the receiver sent nothing (only the one fake execute of the trigger).
        expect(calls(...spies, T.publish, T.sendMessage)).toEqual(0);
        expect(T.execute).toHaveBeenCalledTimes(1);
    });

    //* receiver via the protocol channel (depth 1, no admin): logs one recv line and returns; never sends (guard 1).
    it('should log recv in the protocol receiver and send nothing (guard 1)', async () => {
        const spies = sendSpies();
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const res: any = await api.doPostLoopRecv(LOOP_ID, {}, message('protocol'), rolesContext([], { depth: 1 }));
        expect(res).toMatchObject({ loopId: LOOP_ID, hop: 1 });
        expect(Object.keys(res)).toEqual(['loopId', 'recvAt', 'hop']);
        expect(info.mock.calls.map(c => c[0])).toEqual([expect.stringMatching(RECV_RE('protocol', ' hop=1'))]);
        expect(calls(...spies, T.publish, T.sendMessage, T.protocol)).toEqual(0);
    });

    //* receiver gate: not via protocol and not admin → 403; admin (direct invoke) is allowed.
    it('should deny the protocol receiver for an external non-admin request', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const deny = `403 NOT ALLOWED - protocol or admin only @doPostLoopRecv(callback/${LOOP_ID})`;
        expect(
            await api.doPostLoopRecv(LOOP_ID, {}, message('protocol'), rolesContext(['user'])).catch(GETERR),
        ).toEqual(deny);
        expect(info).not.toHaveBeenCalled();
        const ok: any = await api.doPostLoopRecv(LOOP_ID, {}, message('protocol'), rolesContext(['admin']));
        expect(ok.loopId).toEqual(LOOP_ID);
        expect(calls(T.publish, T.sendMessage, T.protocol)).toEqual(0);
    });

    //* receiver over express without LOCAL_MODE: 403 (external).
    it('should deny POST /callback/<loopId>/loop-recv over express without LOCAL_MODE', async () => {
        const spies = sendSpies();
        const res = await request(app).post(`/callback/${LOOP_ID}/${RECV_CMD}`).send(message('protocol'));
        expect(res.status).toEqual(403);
        expect(calls(...spies)).toEqual(0);
        expect(info).not.toHaveBeenCalled();
    });

    //* receiver hop cap: hop must be exactly 1 (guard 3); a bad message logs `bad` and returns '' (no throw, no send).
    it('should treat hop !== 1 and other bad values as bad in the protocol receiver (guard 3)', async () => {
        const spies = sendSpies();
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const ctx = rolesContext([], { depth: 1 });
        const bads: [string, any, string][] = [
            [LOOP_ID, message('protocol', { hop: 2 }), `[LOOP] bad kind=protocol loop=${LOOP_ID} reason=hop`],
            [LOOP_ID, message('protocol', { hop: undefined }), `[LOOP] bad kind=protocol loop=${LOOP_ID} reason=hop`],
            [LOOP_ID, message('protocol', { hop: '1' }), `[LOOP] bad kind=protocol loop=${LOOP_ID} reason=hop`],
            [LOOP_ID, message('protocol', { hop: 0 }), `[LOOP] bad kind=protocol loop=${LOOP_ID} reason=hop`],
            [LOOP_ID, message('protocol', { sentAt: 'x' }), `[LOOP] bad kind=protocol loop=${LOOP_ID} reason=sentAt`],
            [LOOP_ID, message('sns'), `[LOOP] bad kind=protocol loop=${LOOP_ID} reason=loop`],
            ['not-a-uuid', message('protocol'), '[LOOP] bad kind=protocol reason=loopId'],
        ];
        for (const [id, body, line] of bads) {
            info.mockClear();
            expect(await api.doPostLoopRecv(id, {}, body, ctx)).toEqual('');
            expect(info.mock.calls.map(c => c[0])).toEqual([line]);
        }
        expect(onLoopRecv(LOOP_ID, null)).toEqual('');
        expect(calls(...spies, T.publish, T.sendMessage, T.protocol)).toEqual(0);
    });

    //! ---------------------------------------------------------------------------------------------------------------
    //! SNS/SQS listener: `onLoopMessage()`
    //! ---------------------------------------------------------------------------------------------------------------

    //* listener: a matching SNS/SQS record logs one recv line and returns a short string.
    it('should log recv for a matching SNS/SQS loop message', () => {
        expect(onLoopMessage('SNS', { subject: LOOP_SUBJECT }, message('sns'))).toEqual(`loop:sns:${LOOP_ID}`);
        const attr = { Subject: LOOP_SUBJECT, loop: 'sqs', loopId: LOOP_ID };
        expect(onLoopMessage('SQS', attr, message('sqs'))).toEqual(`loop:sqs:${LOOP_ID}`);
        expect(info.mock.calls.map(c => c[0])).toEqual([
            expect.stringMatching(RECV_RE('sns')),
            expect.stringMatching(RECV_RE('sqs')),
        ]);
    });

    //* listener: another subject is ignored (no log), incl. the `error` subject of lemon-core error reports (guard 5).
    it('should ignore another subject, incl. error reports', () => {
        const body = message('sns');
        expect(onLoopMessage('SNS', { subject: 'other' }, body)).toEqual('');
        expect(onLoopMessage('SNS', { subject: 'error' }, body)).toEqual('');
        expect(onLoopMessage('SNS', {}, body)).toEqual('');
        expect(onLoopMessage('SQS', { Subject: 'other' }, message('sqs'))).toEqual('');
        //* the subject key is per transport: SNS reads `subject`, SQS reads `Subject`.
        expect(onLoopMessage('SNS', { Subject: LOOP_SUBJECT }, body)).toEqual('');
        expect(onLoopMessage('SQS', { subject: LOOP_SUBJECT }, message('sqs'))).toEqual('');
        expect(onLoopMessage('SNS', null, body)).toEqual('');
        expect(info).not.toHaveBeenCalled();
    });

    //* listener: the transport must match `body.loop` (no log).
    it('should ignore a transport mismatch', () => {
        expect(onLoopMessage('SNS', { subject: LOOP_SUBJECT }, message('sqs'))).toEqual('');
        expect(onLoopMessage('SQS', { Subject: LOOP_SUBJECT }, message('sns'))).toEqual('');
        expect(onLoopMessage('SNS', { subject: LOOP_SUBJECT }, message('protocol'))).toEqual('');
        expect(onLoopMessage('SNS', { subject: LOOP_SUBJECT }, null)).toEqual('');
        expect(onLoopMessage('CRON', { subject: LOOP_SUBJECT }, message('cron'))).toEqual('');
        expect(info).not.toHaveBeenCalled();
    });

    //* listener: bad loop id, sent time, or hop !== 1 (guard 3) logs one bad line and returns ''.
    it('should treat a bad loop id, sentAt or hop !== 1 as bad in the listener (guard 3)', () => {
        const param = { subject: LOOP_SUBJECT };
        expect(onLoopMessage('SNS', param, message('sns', { loopId: undefined }))).toEqual('');
        expect(onLoopMessage('SNS', param, message('sns', { loopId: 'not a uuid' }))).toEqual('');
        expect(onLoopMessage('SNS', param, message('sns', { sentAt: 'x' }))).toEqual('');
        expect(onLoopMessage('SNS', param, message('sns', { hop: 2 }))).toEqual('');
        expect(onLoopMessage('SNS', param, message('sns', { hop: undefined }))).toEqual('');
        expect(onLoopMessage('SQS', { Subject: LOOP_SUBJECT }, message('sqs', { hop: '1' }))).toEqual('');
        expect(info.mock.calls.map(c => c[0])).toEqual([
            '[LOOP] bad kind=sns reason=loopId',
            '[LOOP] bad kind=sns reason=loopId',
            `[LOOP] bad kind=sns loop=${LOOP_ID} reason=sentAt`,
            `[LOOP] bad kind=sns loop=${LOOP_ID} reason=hop`,
            `[LOOP] bad kind=sns loop=${LOOP_ID} reason=hop`,
            `[LOOP] bad kind=sqs loop=${LOOP_ID} reason=hop`,
        ]);
    });

    //* listener never throws (guard 4): an error inside becomes one bad line and ''.
    it('should never throw out of the listener (guard 4)', () => {
        const evil = {
            loop: 'sns',
            get loopId(): string {
                throw new Error('boom');
            },
        };
        expect(() => onLoopMessage('SNS', { subject: LOOP_SUBJECT }, evil)).not.toThrow();
        expect(onLoopMessage('SNS', { subject: LOOP_SUBJECT }, evil)).toEqual('');
        expect(info.mock.calls.map(c => c[0])).toEqual([
            '[LOOP] bad kind=sns reason=error',
            '[LOOP] bad kind=sns reason=error',
        ]);
    });

    //* engine: a synthetic SNS event goes through lemon-core `LambdaSNSHandler` to the listener; nothing is sent.
    it('should reach the listener via $sns.handle() and send nothing (guard 1)', async () => {
        const spies = sendSpies();
        await $sns.handle(snsEvent(LOOP_SUBJECT, message('sns')) as any, null as any);
        expect(($sns as any).$lastResult).toEqual([`loop:sns:${LOOP_ID}`]);
        expect(info.mock.calls.map(c => c[0])).toEqual([expect.stringMatching(RECV_RE('sns'))]);
        //* another subject and a bad hop: '' and no recv line.
        await $sns.handle(snsEvent('other', message('sns')) as any, null as any);
        expect(($sns as any).$lastResult).toEqual(['']);
        await $sns.handle(snsEvent(LOOP_SUBJECT, message('sns', { hop: 2 })) as any, null as any);
        expect(($sns as any).$lastResult).toEqual(['']);
        expect(info).toHaveBeenCalledTimes(2);
        expect(calls(...spies)).toEqual(0);
    });

    //* engine: a synthetic SQS event goes through lemon-core `LambdaSQSHandler`; a bad message is not a failed record.
    it('should reach the listener via $sqs.handle(), send nothing, and never fail the record (guards 1, 4)', async () => {
        const spies = sendSpies();
        const attr = { Subject: LOOP_SUBJECT, loop: 'sqs', loopId: LOOP_ID };
        const res = await $sqs.handle(sqsEvent(attr, message('sqs')) as any, null as any);
        expect(res).toEqual({ batchItemFailures: [] });
        expect(($sqs as any).$lastResult).toEqual([`loop:sqs:${LOOP_ID}`]);
        expect(info.mock.calls[0][0]).toMatch(RECV_RE('sqs'));
        //* a bad loop id or hop: no failed record (no SQS redrive).
        const bad = await $sqs.handle(sqsEvent(attr, message('sqs', { loopId: 'x' })) as any, null as any);
        expect(bad).toEqual({ batchItemFailures: [] });
        const hop = await $sqs.handle(sqsEvent(attr, message('sqs', { hop: 3 })) as any, null as any);
        expect(hop).toEqual({ batchItemFailures: [] });
        expect(info.mock.calls.slice(1).map(c => c[0])).toEqual([
            '[LOOP] bad kind=sqs reason=loopId',
            `[LOOP] bad kind=sqs loop=${LOOP_ID} reason=hop`,
        ]);
        expect(calls(...spies)).toEqual(0);
    });
});
