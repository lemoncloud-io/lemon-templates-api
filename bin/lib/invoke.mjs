/**
 * `bin/lib/invoke.mjs`
 * - one synchronous (or async) `lambda:Invoke` call, shared by `bin/lambda-invoke.mjs` and `bin/fields-admin.mjs`.
 * - no printing and no `process.exit`; SDK errors are thrown as they are.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Lambda client for the resolved SDK config (`resolveAws()`).
export const createClient = aws => new LambdaClient(aws);

// invoke `name` with `event`; returns `{ statusCode, functionError, text, logResult, took }`.
export const invokeLambda = async (client, { name, event, async = false, tail = false }) => {
    const cmd = new InvokeCommand({
        FunctionName: name,
        InvocationType: async ? 'Event' : 'RequestResponse',
        LogType: tail && !async ? 'Tail' : 'None',
        Payload: Buffer.from(JSON.stringify(event)),
    });
    const t0 = Date.now();
    const resp = await client.send(cmd);
    const took = Date.now() - t0;
    // payload bytes as text ('' when none, e.g. async).
    const text = resp.Payload ? new TextDecoder().decode(resp.Payload) : '';
    return { statusCode: resp.StatusCode, functionError: resp.FunctionError, text, logResult: resp.LogResult, took };
};
