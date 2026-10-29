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
 * @date        2026-10-30 add `notify` and `enqueue` (protocol service over SNS/SQS).
 * @date        2026-10-30 12-digit placeholder account for the protocol events (lemon-core B10-6), local transport off.
 * @date        2026-10-30 lemon-core B13: relay hops (`trace.hop`), no hand-raised `depth`, ` tid=… hop=…` lines.
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
import $cores, { GETERR, LambdaHandler, LambdaSNSHandler, LambdaSQSHandler } from 'lemon-core';
import request from 'supertest';
import { readFileSync } from 'fs';
import path from 'path';
import $service from '../../service/backend-service';
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

//! a trace id of the receiver tests (the relay `tid`).
const TID = 'tid-1';

//! a receiver context as lemon-core builds it from a relay (B13 D2): internal, hop 1, the whitelisted identity.
const relayContext = (roles: string[] = []): any => ({
    identity: { roles },
    channel: 'internal',
    depth: 1,
    trace: { tid: TID, hop: 1 },
});

//! env for these tests; `undefined` deletes the name (same pattern as `fields-admin.spec.ts`).
const NO_FILE = 'no-such-aws-file';
const ENV: { [key: string]: string | undefined } = {
    PROFILE: '',
    AWS_PROFILE: undefined,
    AWS_CONFIG_FILE: NO_FILE,
    AWS_SHARED_CREDENTIALS_FILE: NO_FILE,
    AWS_EC2_METADATA_DISABLED: 'true', //* a stray credential lookup fails fast (no instance-metadata wait).
    LOCAL_MODE: undefined,
    LOCAL_TRANSPORT: undefined, //* lemon-core's local transport is off here (see `api-callback-loop-mock.spec.ts`).
    AWS_LAMBDA_FUNCTION_NAME: undefined,
    REPORT_ERROR_ARN: '', //* `getHelloArn()` then builds from `context.accountId` (no real topic in this spec).
};

//! a placeholder account: `getHelloArn()` takes a 12-digit account only (lemon-core B10-6).
const ACCOUNT = '000000000000';

//! set (or delete) each name of a map in `process.env`.
const setEnv = (M: { [key: string]: string | undefined }) =>
    Object.entries(M).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));

//! the static `REPORT_ERROR` flags: off in this spec, so a failure never publishes an error report (no AWS).
const REPORTERS: any[] = [LambdaHandler, LambdaSNSHandler, LambdaSQSHandler, $cores.cores.protocol.service.constructor];

//! fake transports that record each call (`protocol` records the context, the target and the options too).
const fakeTransports = (onExecute?: (ctx: any, service: string, body: any) => any) => {
    const publish = jest.fn<Promise<string>, [string, string, any]>(async () => 'sns-mid-1');
    const sendMessage = jest.fn<Promise<string>, [any, any?]>(async () => 'sqs-mid-1');
    const execute = jest.fn();
    const notify = jest.fn<Promise<string>, any[]>(async () => 'notify-mid-1');
    const enqueue = jest.fn<Promise<string>, any[]>(async () => 'enqueue-mid-1');
    const protocol = jest.fn((context: any, service: string, options?: any) => ({
        execute: async (param?: any, body?: any, mode?: string) => {
            execute(param, body, mode);
            return onExecute ? onExecute(context, service, body) : { loopId: body?.loopId, recvAt: 1, hop: body?.hop };
        },
        notify,
        enqueue,
        options, //* kept for the record (the calls also hold it).
    }));
    const $aws: LoopTransports = { sns: { publish }, sqs: { sendMessage }, protocol };
    return { publish, sendMessage, protocol, execute, notify, enqueue, provider: () => $aws };
};

//! a protocol param to `callback/<id>/<cmd>` as `$protocol().notify()/enqueue()` builds it (the caller context: hop 0).
const protoParam = (kind: string, more?: any, id = LOOP_ID, cmd = RECV_CMD) => ({
    mode: 'POST',
    type: 'callback',
    id,
    cmd,
    body: message(kind, more),
    context: { accountId: ACCOUNT, requestId: 'r-1', identity: { roles: ['admin'] } },
});

//! one web protocol hop as lemon-core runs it: the sender's event (`x-lemon-relay`) → the receiver's `packContext()`
//! → `handleProtocol()`. `service` is `//self/<type>/<id>/<cmd>`.
const webHop = async (ctx: any, service: string, body: any) => {
    const [, , , type, id, cmd] = service.split('/');
    const web: any = ($cores.cores.protocol.service as any).asTransformer('web');
    const event = web.transformToEvent(`api://self/${type}/${id}/${cmd}`, {
        mode: 'POST',
        type,
        id,
        cmd,
        body,
        context: ctx,
    });
    const context = await $web.packContext(event, null);
    return $web.handleProtocol(web.transformToParam(event, context), event);
};

//! the SNS Lambda event of a protocol param, built by the lemon-core transformer (signed as in production).
const snsProtocolEvent = (param: any) => {
    const sent = ($cores.cores.protocol.service as any).asTransformer('sns').transformToEvent('sns://loop-sns', param);
    const attrs = Object.entries(sent.MessageAttributes).reduce(
        (M: any, [k, v]: [string, any]) => ({ ...M, [k]: { Type: v.DataType, Value: v.StringValue } }),
        {},
    );
    const Sns = { Subject: sent.Subject, Message: JSON.parse(sent.Message).default, MessageAttributes: attrs };
    return { sent, event: { Records: [{ EventSource: 'aws:sns', EventVersion: '1.0', Sns }] } };
};

//! the SQS Lambda event of a protocol param, built by the lemon-core transformer (signed as in production).
const sqsProtocolEvent = (param: any) => {
    const sent = ($cores.cores.protocol.service as any).asTransformer('sqs').transformToEvent('sqs://loop-sqs', param);
    const attrs = Object.entries(sent.MessageAttributes).reduce(
        (M: any, [k, v]: [string, any]) => ({ ...M, [k]: { dataType: v.DataType, stringValue: v.StringValue } }),
        {},
    );
    const record = { messageId: 'm-1', receiptHandle: 'h-1', body: sent.MessageBody, messageAttributes: attrs };
    return { sent, event: { Records: [{ ...record, attributes: {}, eventSource: 'aws:sqs' }] } };
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

//! a context with `identity.roles` only, like a direct invoke with `--identity '{"sid":"loop-check","roles":["admin"]}'`.
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
        expect(info.mock.calls.map(c => c[0])).toEqual([
            `[LOOP] send kind=sns loop=${res.loopId} message=sns-mid-1 tid=- hop=0`,
        ]);
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
        expect(info.mock.calls.map(c => c[0])).toEqual([
            `[LOOP] send kind=sqs loop=${res.loopId} message=sqs-mid-1 tid=- hop=0`,
        ]);
    });

    //* protocol: execute() once to `//self/callback/<loopId>/loop-recv` with the payload as body, admin, no `depth`.
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
        const [context, service, options] = T.protocol.mock.calls[0];
        expect(service).toEqual(`//self/callback/${res.loopId}/${RECV_CMD}`);
        expect(options).toEqual({ isProd: false });
        expect(context).toMatchObject({ requestId: 'r-1', identity: { roles: ['admin'] } });
        expect('depth' in context).toBe(false); //* lemon-core counts the hop; the relay never carries `depth`.
        expect(T.execute).toHaveBeenCalledWith(
            null,
            { loop: 'protocol', loopId: res.loopId, sentAt: res.sentAt, hop: 1 },
            'POST',
        );
        expect(calls(T.publish, T.sendMessage, T.notify, T.enqueue)).toEqual(0);
        const lines = info.mock.calls.map(c => c[0]);
        expect(lines[0]).toEqual(`[LOOP] send kind=protocol loop=${res.loopId} message=- tid=r-1 hop=0`);
        expect(lines[1]).toMatch(
            new RegExp(`^\\[LOOP\\] done kind=protocol loop=${res.loopId} rtt=\\d+ms tid=r-1 hop=0$`),
        );
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
        expect(param.context).toMatchObject({ identity: { roles: ['admin'] } });
        expect(param.context.depth).toBeUndefined();
        expect(calls(...spies)).toEqual(1);
    });

    //* notify: `$protocol(ctx, '//self/callback/<loopId>/loop-recv').notify(null, payload, 'POST')`, never a callback.
    it('should notify the protocol loop without a callback (notify guard)', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const res: any = await api.doPostLoop('notify', {}, {}, rolesContext(['admin'], { requestId: 'r-2' }));
        expect(Object.keys(res)).toEqual(['kind', 'loopId', 'messageId', 'sentAt']);
        expect(res).toMatchObject({ kind: 'notify', messageId: 'notify-mid-1' });
        const [context, service, options] = T.protocol.mock.calls[0];
        expect(service).toEqual(`//self/callback/${res.loopId}/${RECV_CMD}`);
        expect(options).toEqual({ isProd: false });
        expect(context).toMatchObject({ requestId: 'r-2', identity: { roles: ['admin'] } });
        expect('depth' in context).toBe(false);
        expect(T.notify).toHaveBeenCalledTimes(1);
        expect(T.notify.mock.calls[0]).toEqual([
            null,
            { loop: 'notify', loopId: res.loopId, sentAt: res.sentAt, hop: 1 },
            'POST',
            undefined,
        ]);
        expect(T.notify.mock.calls[0][3]).toBeUndefined(); //* no callback (a callback means one more execute).
        expect(calls(T.publish, T.sendMessage, T.execute, T.enqueue)).toEqual(0);
        expect(info.mock.calls.map(c => c[0])).toEqual([
            `[LOOP] send kind=notify loop=${res.loopId} message=notify-mid-1 tid=r-2 hop=0`,
        ]);
    });

    //* enqueue: `.enqueue(null, payload, 'POST', undefined, 0)`, never a callback.
    it('should enqueue the protocol loop without a callback (enqueue guard)', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const res: any = await api.doPostLoop('enqueue', {}, { note: 'q' }, rolesContext(['admin']));
        expect(Object.keys(res)).toEqual(['kind', 'loopId', 'messageId', 'sentAt']);
        expect(res).toMatchObject({ kind: 'enqueue', messageId: 'enqueue-mid-1' });
        expect(T.protocol.mock.calls[0][1]).toEqual(`//self/callback/${res.loopId}/${RECV_CMD}`);
        expect(T.protocol.mock.calls[0][0]).toMatchObject({ identity: { roles: ['admin'] } });
        expect('depth' in T.protocol.mock.calls[0][0]).toBe(false);
        expect(T.enqueue.mock.calls[0]).toEqual([
            null,
            { loop: 'enqueue', loopId: res.loopId, sentAt: res.sentAt, hop: 1, note: 'q' },
            'POST',
            undefined,
            0,
        ]);
        expect(T.enqueue.mock.calls[0][3]).toBeUndefined(); //* no callback.
        expect(calls(T.publish, T.sendMessage, T.execute, T.notify)).toEqual(0);
        expect(info.mock.calls.map(c => c[0])).toEqual([
            `[LOOP] send kind=enqueue loop=${res.loopId} message=enqueue-mid-1 tid=- hop=0`,
        ]);
    });

    //* notify/enqueue with the real `$protocol()`: the protocol service gets the param and no callback.
    it('should pass no callback to the protocol service for notify/enqueue (real $protocol)', async () => {
        const spies = sendSpies();
        const [, , , notify, enqueue] = spies;
        const api = new CallbackAPIController();
        const a: any = await api.doPostLoop('notify', {}, {}, rolesContext(['admin']));
        const b: any = await api.doPostLoop('enqueue', {}, {}, rolesContext(['admin']));
        expect(a.messageId).toEqual('n');
        expect(b.messageId).toEqual('q');
        const [p1, cb1] = notify.mock.calls[0] as any[];
        expect(cb1).toBeUndefined();
        expect(p1).toMatchObject({ mode: 'POST', type: 'callback', id: a.loopId, cmd: RECV_CMD });
        expect(p1.body).toEqual({ loop: 'notify', loopId: a.loopId, sentAt: a.sentAt, hop: 1 });
        expect(p1.context).toMatchObject({ identity: { roles: ['admin'] } });
        expect(p1.context.depth).toBeUndefined();
        const [p2, cb2, delay] = enqueue.mock.calls[0] as any[];
        expect(cb2).toBeUndefined();
        expect(delay).toEqual(0);
        expect(p2).toMatchObject({ mode: 'POST', type: 'callback', id: b.loopId, cmd: RECV_CMD });
        expect(p2.body).toEqual({ loop: 'enqueue', loopId: b.loopId, sentAt: b.sentAt, hop: 1 });
        expect(calls(...spies)).toEqual(2);
    });

    //* notify/enqueue reach `backend`: lemon-core maps this service to the topic and the queue `backend` subscribes to.
    it('should map notify/enqueue to the topic and the queue of backend (serverless.yml)', () => {
        const yml = readFileSync(path.join(__dirname, '../../../serverless.yml'), 'utf8');
        const service = (yml.match(/^service:\s*['"]?([\w.-]+)/m) || [])[1];
        //* a stage map of `custom` like `topicName:` → { dev: …, prod: … }.
        const mapOf = (name: string) => {
            const block = (yml.match(new RegExp(`^  ${name}:\\n((?:    \\w+: .+\\n)+)`, 'm')) || [])[1] || '';
            return block.split('\n').reduce((M: any, line) => {
                const m = line.match(/^\s+(\w+):\s*(\S+)/);
                return m ? { ...M, [m[1]]: m[2] } : M;
            }, {});
        };
        const topics = mapOf('topicName');
        const queues = mapOf('queueName');
        //* `backend` subscribes to the topic of `topicName` and the queue `MyQueue` (= `queueName`).
        const backend = yml.substring(yml.indexOf('  backend:'), yml.indexOf('  lambda:'));
        expect(backend).toMatch(/- sns: .*custom\.topicName\./);
        expect(backend).toMatch(/- sqs:[\s\S]*MyQueue/);
        expect(yml).toMatch(/QueueName: .*custom\.queueName\./);
        //* the host of the protocol uri is the topic / queue name.
        const MyProtocolService: any = $cores.cores.protocol.service.constructor;
        const build = MyProtocolService.buildProtocolURI.bind(MyProtocolService); //* static, uses `this.asPath()`.
        const host = (protocol: string, stage: string) =>
            `${build(null, {}, protocol, service, stage, 'callback', LOOP_ID, RECV_CMD)}`.split('/')[2];
        for (const stage of ['dev', 'prod']) {
            expect(topics[stage]).toBeTruthy();
            expect(host('sns', stage)).toEqual(topics[stage]);
            expect(host('sqs', stage)).toEqual(queues[stage]);
        }
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
        const r4 = await request(app).post('/callback/notify/loop').send({});
        expect(r4.status).toEqual(200);
        expect(r4.body).toMatchObject({ kind: 'notify', messageId: 'n' });
        const r5 = await request(app).post('/callback/enqueue/loop').send({});
        expect(r5.status).toEqual(200);
        expect(r5.body).toMatchObject({ kind: 'enqueue', messageId: 'q' });
        expect(spies.map(f => f.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 0]);
        expect([publish, send, execute].map(f => f.mock.calls.length)).toEqual([1, 1, 1]);
    });

    //! ---------------------------------------------------------------------------------------------------------------
    //! guard 2: a nested trigger (re-entry through the protocol channel) is refused
    //! ---------------------------------------------------------------------------------------------------------------

    //* `trace.hop > 0`, or a source path of another route (legacy context): `400 INVALID LOOP - nested trigger`, no send.
    it('should refuse a nested trigger with 400 (guard 2)', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const nested = '400 INVALID LOOP - nested trigger';
        for (const kind of ['sns', 'sqs', 'protocol', 'notify', 'enqueue']) {
            const deep = relayContext(['admin']);
            expect(await api.doPostLoop(kind, {}, {}, deep).catch(GETERR)).toEqual(nested);
            const other = rolesContext(['admin'], { source: 'api://1@self-api/callback/protocol/loop#1' });
            if (kind !== 'protocol') expect(await api.doPostLoop(kind, {}, {}, other).catch(GETERR)).toEqual(nested);
            const recv = rolesContext(['admin'], { source: `api://1@self-api/callback/${LOOP_ID}/${RECV_CMD}#1` });
            expect(await api.doPostLoop(kind, {}, {}, recv).catch(GETERR)).toEqual(nested);
        }
        expect(calls(T.publish, T.sendMessage, T.protocol, T.notify, T.enqueue)).toEqual(0);
        //* a direct request: its own route as source (lemon-core `packContext()`), or no path at all.
        expect(isNestedTrigger({ source: 'api://1@self-api/callback/sns/loop#1' }, 'callback', 'sns')).toBe(false);
        expect(isNestedTrigger({ source: 'api://0008540000@lemon-hello-api#2.12.24a' }, 'callback', 'sns')).toBe(false);
        expect(isNestedTrigger({}, 'callback', 'sns')).toBe(false);
        //* B13 entries with hop 0: a direct invoke (`internal`) and a local request (`local`) are allowed.
        const own = 'api://1@self-api/callback/sns/loop#1';
        const entry = (channel: string): any => ({ channel, source: own, trace: { tid: 't', hop: 0 } });
        expect(isNestedTrigger(entry('internal'), 'callback', 'sns')).toBe(false);
        expect(isNestedTrigger(entry('local'), 'callback', 'sns')).toBe(false);
        expect(isNestedTrigger(entry('external'), 'callback', 'sns')).toBe(false);
        //* a relay hop is nested even with its own route as `source` (the relay `src` is the first entry path).
        expect(isNestedTrigger({ ...entry('internal'), trace: { tid: 't', hop: 1 } }, 'callback', 'sns')).toBe(true);
        //* a hand-raised `depth` is not read (the relay never carries it; lemon-core sets `depth` = hop).
        expect(isNestedTrigger({ depth: 3, source: own } as any, 'callback', 'sns')).toBe(false);
        expect(sourcePath('api://a@b-api/x/y/z#1')).toEqual('/x/y/z');
        expect(sourcePath(undefined)).toEqual('');
    });

    //* in-process: a protocol send (relay, hop 1) that lands on a trigger route is refused by the receiver (guard 2).
    it('should refuse a trigger re-entered through $web.handleProtocol() (guard 2)', async () => {
        const contexts: any[] = [];
        const T = fakeTransports(async (ctx, service, body) => {
            contexts.push(ctx);
            return webHop(ctx, '//self/callback/sns/loop', body);
        });
        const api = new CallbackAPIController(undefined, T.provider);
        const ctx = rolesContext(['admin'], { channel: 'internal', requestId: 'r-1', trace: { tid: TID, hop: 0 } });
        const err = await api.doPostLoop('protocol', {}, {}, ctx).catch(GETERR);
        expect(err).toEqual('400 INVALID LOOP - nested trigger');
        expect(calls(T.publish, T.sendMessage)).toEqual(0);
        expect(T.protocol).toHaveBeenCalledTimes(1);
        //* the sender context is not raised by hand: hop 0 (lemon-core makes hop 1 in the relay).
        expect(contexts[0].trace).toEqual({ tid: TID, hop: 0 });
        expect(contexts[0].depth).toBeUndefined();
    });

    //* SNS/SQS: a protocol message (relay, hop 1) to a trigger route is refused; nothing is sent (guard 2).
    it('should refuse a trigger re-entered through the SNS/SQS protocol paths (guard 2)', async () => {
        const spies = sendSpies();
        const errs: string[] = [];
        //* the loop's `[LOOP] bad`/recv lines never appear: the trigger route throws before any send.
        const sns = snsProtocolEvent(protoParam('sns', {}, 'sns', 'loop'));
        await $sns.handle(sns.event as any, null as any);
        errs.push(`${($sns as any).$lastResult[0]}`);
        const sqs = sqsProtocolEvent(protoParam('sqs', {}, 'sqs', 'loop'));
        const res = await $sqs.handle(sqs.event as any, null as any);
        expect(res).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-1' }] });
        errs.push(`${($sqs as any).$lastResult[0]}`);
        errs.forEach(e => expect(e).toContain('400 INVALID LOOP - nested trigger'));
        expect(info).not.toHaveBeenCalled();
        expect(calls(...spies)).toEqual(0);
    });

    //! ---------------------------------------------------------------------------------------------------------------
    //! protocol receiver: `POST /callback/<loopId>/loop-recv`
    //! ---------------------------------------------------------------------------------------------------------------

    //* in-process full loop: trigger → execute → `$web.handleProtocol()` → receiver → result back to the trigger.
    it('should run the protocol loop in-process through $web.handleProtocol()', async () => {
        const spies = sendSpies();
        //* each hop goes through the real relay (web transformer → `packContext()`), like `//self` on Lambda.
        const T = fakeTransports((ctx, service, body) => webHop(ctx, service, body));
        const api = new CallbackAPIController(undefined, T.provider);
        const ctx = rolesContext(['user', 'admin'], {
            channel: 'internal',
            requestId: 'r-1',
            trace: { tid: TID, hop: 0 },
        });
        const res: any = await api.doPostLoop('protocol', {}, {}, ctx);
        expect(res.result).toMatchObject({ loopId: res.loopId, hop: 1 });
        expect(res.result.recvAt).toBeGreaterThanOrEqual(res.sentAt);
        const lines = info.mock.calls.map(c => c[0]);
        //* one `tid` joins send, recv and done; the receiver is hop 1.
        expect(lines[0]).toEqual(`[LOOP] send kind=protocol loop=${res.loopId} message=- tid=${TID} hop=0`);
        expect(lines[1]).toMatch(
            new RegExp(`^\\[LOOP\\] recv kind=protocol loop=${res.loopId} latency=\\d+ms tid=${TID} hop=1$`),
        );
        expect(lines[2]).toMatch(
            new RegExp(`^\\[LOOP\\] done kind=protocol loop=${res.loopId} rtt=\\d+ms tid=${TID} hop=0$`),
        );
        //* the receiver sent nothing (only the one fake execute of the trigger).
        expect(calls(...spies, T.publish, T.sendMessage)).toEqual(0);
        expect(T.execute).toHaveBeenCalledTimes(1);
    });

    //* receiver via the protocol channel (relay hop 1, no admin): logs one recv line and returns; never sends (guard 1).
    it('should log recv in the protocol receiver and send nothing (guard 1)', async () => {
        const spies = sendSpies();
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const res: any = await api.doPostLoopRecv(LOOP_ID, {}, message('protocol'), relayContext());
        expect(res).toMatchObject({ loopId: LOOP_ID, hop: 1 });
        expect(Object.keys(res)).toEqual(['loopId', 'recvAt', 'hop']);
        expect(info.mock.calls.map(c => c[0])).toEqual([
            expect.stringMatching(RECV_RE('protocol', ` tid=${TID} hop=1`)),
        ]);
        expect(calls(...spies, T.publish, T.sendMessage, T.protocol)).toEqual(0);
    });

    //* receiver: `notify` (SNS) and `enqueue` (SQS) deliveries log their own kind; nothing is sent.
    it('should log recv for notify and enqueue in the protocol receiver (guard 1)', async () => {
        const spies = sendSpies();
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const ctx = relayContext();
        expect(await api.doPostLoopRecv(LOOP_ID, {}, message('notify'), ctx)).toMatchObject({
            loopId: LOOP_ID,
            hop: 1,
        });
        expect(await api.doPostLoopRecv(LOOP_ID, {}, message('enqueue'), ctx)).toMatchObject({ loopId: LOOP_ID });
        expect(info.mock.calls.map(c => c[0])).toEqual([
            expect.stringMatching(RECV_RE('notify', ` tid=${TID} hop=1`)),
            expect.stringMatching(RECV_RE('enqueue', ` tid=${TID} hop=1`)),
        ]);
        expect(calls(...spies, T.publish, T.sendMessage, T.protocol, T.execute, T.notify, T.enqueue)).toEqual(0);
    });

    //* receiver via the protocol channel never throws (an SQS throw = redelivery, an SNS throw = an error report).
    it('should never throw in the protocol receiver via the protocol channel (receiver guard)', async () => {
        const spies = sendSpies();
        const api = new CallbackAPIController();
        const guard = jest.spyOn($service, 'guardProxy').mockRejectedValue(new Error('boom'));
        const ctx = relayContext();
        expect(await api.doPostLoopRecv(LOOP_ID, {}, message('notify'), ctx)).toEqual('');
        expect(info.mock.calls.map(c => c[0])).toEqual(['[LOOP] bad kind=notify reason=error']);
        //* a direct call keeps its error (only the protocol channel is caught).
        expect(await api.doPostLoopRecv(LOOP_ID, {}, message('notify'), rolesContext(['admin'])).catch(GETERR)).toEqual(
            'boom',
        );
        //* an external request is never the protocol channel, even with a hop (it keeps its error too).
        const forged = { ...relayContext(['admin']), channel: 'external' };
        expect(await api.doPostLoopRecv(LOOP_ID, {}, message('notify'), forged).catch(GETERR)).toEqual('boom');
        guard.mockRestore();
        //* an error inside the receiver body is caught too.
        const evil = {
            loop: 'enqueue',
            get sentAt(): number {
                throw new Error('boom');
            },
        };
        info.mockClear();
        expect(await api.doPostLoopRecv(LOOP_ID, {}, evil, ctx)).toEqual('');
        expect(info.mock.calls.map(c => c[0])).toEqual(['[LOOP] bad kind=enqueue reason=error']);
        expect(calls(...spies)).toEqual(0);
    });

    //* receiver gate: not via protocol and not admin → 403; admin (direct invoke, external or local) is allowed.
    it('should deny the protocol receiver for an external non-admin request', async () => {
        const T = fakeTransports();
        const api = new CallbackAPIController(undefined, T.provider);
        const deny = `403 NOT ALLOWED - protocol or admin only @doPostLoopRecv(callback/${LOOP_ID})`;
        const recv = (ctx: any) => api.doPostLoopRecv(LOOP_ID, {}, message('protocol'), ctx).catch(GETERR);
        const entry = (channel: string, roles: string[]) =>
            rolesContext(roles, { channel, trace: { tid: TID, hop: 0 } });
        //* non-admin: external, direct invoke and local (hop 0) → 403.
        expect(await recv(rolesContext(['user']))).toEqual(deny);
        expect(await recv(entry('external', ['user']))).toEqual(deny);
        expect(await recv(entry('internal', []))).toEqual(deny);
        expect(await recv(entry('local', []))).toEqual(deny);
        //* a hand-raised `depth` is not the protocol channel; neither is an external context with a hop.
        expect(await recv(rolesContext([], { depth: 1 }))).toEqual(deny);
        expect(await recv({ ...relayContext(), channel: 'external' })).toEqual(deny);
        expect(info).not.toHaveBeenCalled();
        //* admin: allowed on any channel (direct invoke, external, local).
        const ok: any = await recv(rolesContext(['admin']));
        expect(ok.loopId).toEqual(LOOP_ID);
        expect((await recv(entry('external', ['admin']))).loopId).toEqual(LOOP_ID);
        expect((await recv(entry('internal', ['admin']))).loopId).toEqual(LOOP_ID);
        expect(info.mock.calls.map(c => c[0])).toEqual([
            expect.stringMatching(RECV_RE('protocol', ' tid=- hop=0')),
            expect.stringMatching(RECV_RE('protocol', ` tid=${TID} hop=0`)),
            expect.stringMatching(RECV_RE('protocol', ` tid=${TID} hop=0`)),
        ]);
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
        const ctx = relayContext();
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

    //* engine: a `notify` delivery (SNS, `x-protocol-service`) runs `loop-recv` through lemon-core; nothing is sent.
    it('should deliver notify through the SNS protocol path to loop-recv (guard 1)', async () => {
        const { sent, event } = snsProtocolEvent(protoParam('notify'));
        expect(sent.Subject).toEqual('x-protocol-service');
        expect('callback' in sent.MessageAttributes).toBe(false);
        const spies = sendSpies();
        await $sns.handle(event as any, null as any);
        expect(JSON.parse(($sns as any).$lastResult[0])).toMatchObject({ loopId: LOOP_ID, hop: 1 });
        //* the relay: the sender's `requestId` is the `tid` (no `trace` yet), and the receiver is hop 1.
        expect(info.mock.calls.map(c => c[0])).toEqual([expect.stringMatching(RECV_RE('notify', ' tid=r-1 hop=1'))]);
        expect(calls(...spies)).toEqual(0);
    });

    //* engine: an `enqueue` delivery (SQS, `x-protocol-service`) runs `loop-recv`; a bad or failing one never fails the record.
    it('should deliver enqueue through the SQS protocol path and never fail the record (receiver guard)', async () => {
        const good = sqsProtocolEvent(protoParam('enqueue'));
        expect(good.sent.MessageAttributes.Subject.StringValue).toEqual('x-protocol-service');
        expect('callback' in good.sent.MessageAttributes).toBe(false);
        const hop = sqsProtocolEvent(protoParam('enqueue', { hop: 2 }));
        const spies = sendSpies();
        expect(await $sqs.handle(good.event as any, null as any)).toEqual({ batchItemFailures: [] });
        expect(info.mock.calls[0][0]).toMatch(RECV_RE('enqueue', ' tid=r-1 hop=1'));
        expect(await $sqs.handle(hop.event as any, null as any)).toEqual({ batchItemFailures: [] });
        expect(info.mock.calls[1][0]).toEqual(`[LOOP] bad kind=enqueue loop=${LOOP_ID} reason=hop`);
        //* an error in the receiver (here: the proxy) is caught, so the record does not fail (no redelivery).
        jest.spyOn($service, 'guardProxy').mockRejectedValue(new Error('boom'));
        expect(await $sqs.handle(good.event as any, null as any)).toEqual({ batchItemFailures: [] });
        expect(info.mock.calls[2][0]).toEqual('[LOOP] bad kind=enqueue reason=error');
        expect(calls(...spies)).toEqual(0);
    });
});
