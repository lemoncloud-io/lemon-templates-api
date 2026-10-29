/**
 * `loop.ts`
 * - verifiable loop test of the callback module: one admin request to `lambda` sends one message,
 *   and the receiver logs one `[LOOP] recv` line in CloudWatch (checked by `npm run loop:check`).
 *   1. `sns`: `sns.publish()` → `backend` → lemon-core `LambdaSNSHandler` → `onLoopMessage()`
 *   2. `sqs`: `sqs.sendMessage()` → `backend` → lemon-core `LambdaSQSHandler` → `onLoopMessage()`
 *   3. `protocol`: `$protocol().execute()` → `lambda` → `POST /callback/<loopId>/loop-recv` → `onLoopRecv()`
 *   4. `notify`: `$protocol().notify()` → SNS (`x-protocol-service`) → `backend` → `loop-recv` → `onLoopRecv()`
 *   5. `enqueue`: `$protocol().enqueue()` → SQS (`x-protocol-service`) → `backend` → `loop-recv` → `onLoopRecv()`
 * - the routes are in `api-callback.ts` (`doPostLoop()`, `doPostLoopRecv()`).
 * - infinite-loop guards: receivers only log and return (never send), a nested trigger is refused,
 *   `hop` must be exactly 1 (never forwarded), no callback on notify/enqueue, and the SNS/SQS listener and
 *   the protocol receiver (via the protocol channel) never throw (no retry, no redrive).
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (SNS/SQS/protocol loop test).
 * @date        2026-10-30 add `notify` and `enqueue` (protocol service over SNS/SQS).
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/modules/callback`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import $cores, { $U, _log, _inf, _err, $protocol, NextContext } from 'lemon-core';
import { randomUUID } from 'crypto';
const NS = $U.NS('loop', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * subject of a loop message (SNS `Subject`, SQS attribute `Subject`).
 */
export const LOOP_SUBJECT = 'x-loop-test';

/**
 * cmd of the trigger route: `POST /callback/<kind>/loop`.
 */
export const LOOP_CMD = 'loop';

/**
 * cmd of the protocol receiver route: `POST /callback/<loopId>/loop-recv`.
 */
export const RECV_CMD = 'loop-recv';

/**
 * the only valid hop of a loop message (a receiver never forwards).
 */
export const LOOP_HOP = 1;

/**
 * max length of the optional `note` echoed in the payload.
 */
export const MAX_NOTE = 100;

/**
 * transport of one loop.
 */
export type LoopKind = 'sns' | 'sqs' | 'protocol' | 'notify' | 'enqueue';

/**
 * every loop kind (`POST /callback/<kind>/loop`).
 */
export const LOOP_KINDS: LoopKind[] = ['sns', 'sqs', 'protocol', 'notify', 'enqueue'];

/**
 * kinds that go through the lemon-core protocol service and end at `POST /callback/<loopId>/loop-recv`.
 */
export type ProtocolKind = 'protocol' | 'notify' | 'enqueue';

/**
 * every protocol kind (`onLoopRecv()` accepts these as `body.loop`).
 */
export const PROTOCOL_KINDS: ProtocolKind[] = ['protocol', 'notify', 'enqueue'];

/**
 * options of `$protocol()` for a loop: `isProd: false` keeps `//self` on this stage
 * (without it, the helper forces stage `prod` when env `NS` is `SS`).
 */
export const PROTOCOL_OPTIONS = { isProd: false };

/**
 * payload of one loop message (SNS `Message` JSON, SQS body, protocol body).
 */
export interface LoopPayload {
    /** transport of this loop */
    loop: LoopKind;
    /** unique id of this loop (UUID) */
    loopId: string;
    /** sent time (epoch ms) */
    sentAt: number;
    /** hop count (always 1) */
    hop: number;
    /** (optional) note from the request body */
    note?: string;
}

/**
 * the send side: lemon-core SNS/SQS services and `$protocol()` (injectable for jest).
 */
export interface LoopTransports {
    /** `$cores.cores.aws.sns` */
    sns: { publish: (target: string, subject: string, payload: any) => Promise<string> };
    /** `$cores.cores.aws.sqs` */
    sqs: { sendMessage: (data: any, attr?: { [key: string]: string | number }) => Promise<string> };
    /** `$protocol()` of lemon-core */
    protocol: (context: NextContext, service: string, options?: { isProd?: boolean }) => LoopProtocol;
}

/**
 * the part of `$protocol()` a loop uses. a loop never passes `callback` to `notify()`/`enqueue()`.
 */
export interface LoopProtocol {
    /** synchronized call via Lambda (`web`) */
    execute: (param?: any, body?: any, mode?: string) => Promise<any>;
    /** async call via SNS (`x-protocol-service`) */
    notify: (param?: any, body?: any, mode?: string, callback?: string) => Promise<string>;
    /** async call via SQS (`x-protocol-service`) */
    enqueue: (param?: any, body?: any, mode?: string, callback?: string, delaySeconds?: number) => Promise<string>;
}

//* the default transports (SNS/SQS endpoints from env `MY_SNS_ENDPOINT`/`MY_SQS_ENDPOINT`).
export const defaultTransports = (): LoopTransports => ({
    sns: $cores.cores.aws.sns,
    sqs: $cores.cores.aws.sqs,
    protocol: (context, service, options) => $protocol(context, service, options),
});

//* the loop log writer (one `_inf` line); an object, so jest can spy on `inf`.
export const loopLog = {
    inf: (line: string): void => _inf(NS, line),
};

//* UUID shape of a loop id (`crypto.randomUUID()`).
const LOOP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

//* true for a loop id (UUID string).
export const isLoopId = (s: any): s is string => typeof s === 'string' && LOOP_ID_RE.test(s);

//* true for a known loop kind.
export const isLoopKind = (s: any): s is LoopKind => LOOP_KINDS.includes(s);

//* true for a kind that goes through the protocol service.
export const isProtocolKind = (s: any): s is ProtocolKind => PROTOCOL_KINDS.includes(s);

//* the kind label of a received protocol body (never throws): `body.loop` when it is a protocol kind, else `protocol`.
export const loopKindOf = (body: any): ProtocolKind => {
    try {
        return isProtocolKind(body?.loop) ? body.loop : 'protocol';
    } catch (e) {
        return 'protocol';
    }
};

/**
 * build the payload: a fresh loop id, the sent time, hop 1, and the optional note (string only, trimmed, capped).
 */
export const asLoopPayload = (kind: LoopKind, body: any): LoopPayload => {
    const payload: LoopPayload = { loop: kind, loopId: randomUUID(), sentAt: Date.now(), hop: LOOP_HOP };
    const note = typeof body?.note === 'string' ? body.note.trim().substring(0, MAX_NOTE) : '';
    if (note) payload.note = note;
    return payload;
};

/**
 * path of a protocol uri like `api://<acct>@<host>/<type>/<id>/<cmd>#<ver>` ('' when it has none).
 */
export const sourcePath = (source: any): string => {
    if (typeof source !== 'string') return '';
    const m = source.match(/^[a-z]+:\/\/[^/#?]*(\/[^#?]*)?/i);
    return (m && m[1]) || '';
};

/**
 * true if this trigger request did not come straight from a client (re-entry through the protocol channel).
 * - `depth > 0`: lemon-core raises `context.depth` per protocol hop, and our protocol send raises it too.
 * - a protocol call carries the caller's context, so its `source` path is the caller's route, not this one.
 *   (lemon-core sets `source` to this request's own `/<type>/<id>/<cmd>` for a direct request.)
 */
export const isNestedTrigger = (context: NextContext, type: string, id: string): boolean => {
    if ($U.N(context?.depth, 0) > 0) return true;
    const path = sourcePath(context?.source);
    return !!path && path !== `/${type}/${encodeURIComponent(id)}/${LOOP_CMD}`;
};

/**
 * the reason a received loop message is bad ('' if good): loop id, sent time, then hop.
 */
export const badReason = (body: any, loopId: any): string => {
    if (!isLoopId(loopId)) return 'loopId';
    if (typeof body?.sentAt !== 'number' || !Number.isFinite(body.sentAt) || body.sentAt <= 0) return 'sentAt';
    if (body?.hop !== LOOP_HOP) return 'hop';
    return '';
};

//* the bad line: the loop id only when valid (an invalid value is never echoed).
const badLine = (kind: string, loopId: any, reason: string) =>
    `[LOOP] bad kind=${kind}${isLoopId(loopId) ? ` loop=${loopId}` : ''} reason=${reason}`;

/**
 * SNS/SQS listener for loop messages (registered in `engine.ts`). log only: it never sends anything.
 * - acts only on subject `x-loop-test` with `body.loop` equal to the transport; else returns '' without a log.
 * - never throws: a bad message (or any error) logs one `[LOOP] bad` line and returns ''
 *   (a throw would mean SNS retries or an SQS redrive).
 *
 * @param type  'SNS' | 'SQS' (from the lemon-core handler)
 * @param param SNS: `{ subject, ...MessageAttributes }`, SQS: message attributes
 * @param body  the parsed message JSON
 * @returns `loop:<kind>:<loopId>` on match, else ''
 */
export const onLoopMessage = (type: string, param: any, body: any): string => {
    const kind = `${type || ''}`.toLowerCase();
    try {
        //* transport and subject key: SNS reads `subject`, SQS reads `Subject`.
        const subject = kind === 'sns' ? param?.subject : kind === 'sqs' ? param?.Subject : undefined;
        if (subject !== LOOP_SUBJECT) return '';
        if (!body || typeof body !== 'object' || body.loop !== kind) return '';
        //* validate the message (loop id, sent time, hop).
        const reason = badReason(body, body.loopId);
        if (reason) {
            loopLog.inf(badLine(kind, body.loopId, reason));
            return '';
        }
        //* the proof line: received by this function, with the end-to-end latency.
        loopLog.inf(`[LOOP] recv kind=${kind} loop=${body.loopId} latency=${Date.now() - body.sentAt}ms`);
        return `loop:${kind}:${body.loopId}`;
    } catch (e) {
        //* never throw out of a listener.
        return onLoopError(kind, e);
    }
};

/**
 * protocol receiver body (`POST /callback/<loopId>/loop-recv`). log only: it never sends anything.
 * - `body.loop` is the kind that delivered it: `protocol` (execute), `notify` (SNS), or `enqueue` (SQS).
 * - never throws: a bad message (loop, loop id, sent time, `hop !== 1`) or any error logs `[LOOP] bad` and returns ''.
 *
 * @param loopId the loop id (path id)
 * @param body   the payload `{ loop, loopId, sentAt, hop }`
 * @returns `{ loopId, recvAt, hop }` on success, else ''
 */
export const onLoopRecv = (loopId: string, body: any): { loopId: string; recvAt: number; hop: number } | '' => {
    const kind = loopKindOf(body);
    try {
        const reason = isProtocolKind(body?.loop) ? badReason(body, loopId) : 'loop';
        if (reason) {
            loopLog.inf(badLine(kind, loopId, reason));
            return '';
        }
        const recvAt = Date.now();
        loopLog.inf(`[LOOP] recv kind=${kind} loop=${loopId} latency=${recvAt - body.sentAt}ms hop=${body.hop}`);
        return { loopId, recvAt, hop: body.hop };
    } catch (e) {
        //* never throw out of a receiver.
        return onLoopError(kind, e);
    }
};

/**
 * the error path of a receiver: log one `[LOOP] bad … reason=error` line, return '' (never throws).
 */
export const onLoopError = (kind: string, e: any): '' => {
    _err(NS, `! err@loop-recv =`, e);
    try {
        loopLog.inf(badLine(kind, null, 'error'));
    } catch (e2) {
        _err(NS, `! err@badLine =`, e2);
    }
    return '';
};
