import { DeployError } from './deploy-plan.mjs';
import { boundedCredentialProvider } from './deploy-credentials.mjs';

/** Loaded only for explicit apply. Offline planning never resolves credentials. */
export async function createDeployClient(config, { credentials, fetchImpl = globalThis.fetch, lambdaClient } = {}) {
    const [{ SignatureV4 }, { HttpRequest }, { Sha256 }, lambda] = await Promise.all([
        import('@smithy/signature-v4'),
        import('@smithy/protocol-http'),
        import('@aws-crypto/sha256-js'),
        import('@aws-sdk/client-lambda'),
    ]);
    const ownedProvider =
        credentials === undefined
            ? boundedCredentialProvider({ profile: config.profile, timeoutMs: config.requestTimeoutMs })
            : undefined;
    const provider = credentials ?? ownedProvider;
    const signer = new SignatureV4({
        credentials: provider,
        region: config.region,
        service: 'execute-api',
        sha256: Sha256,
    });
    const sdk =
        lambdaClient ?? new lambda.LambdaClient({ region: config.region, credentials: provider, maxAttempts: 1 });
    const deadline = async (parentSignal, operation) => {
        const controller = new AbortController();
        const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
        let timer;
        let stop;
        try {
            signal.throwIfAborted();
            return await Promise.race([
                operation(signal),
                new Promise((_, reject) => {
                    stop = () => {
                        ownedProvider?.cancel();
                        reject(new Error('aborted'));
                    };
                    signal.addEventListener('abort', stop, { once: true });
                    timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
                }),
            ]);
        } finally {
            clearTimeout(timer);
            if (stop) signal.removeEventListener('abort', stop);
        }
    };
    return {
        async request({ tool, method = 'POST', input, deployId, resource, signal }) {
            const url = new URL(`${config.endpoint}/tools/${tool}${method === 'GET' ? '/status' : ''}`);
            if (deployId) url.searchParams.set('deployId', deployId);
            if (resource) url.searchParams.set('resource', resource);
            const body = input === undefined ? undefined : JSON.stringify(input);
            try {
                return await deadline(signal, async requestSignal => {
                    const signed = await signer.sign(
                        new HttpRequest({
                            protocol: url.protocol,
                            hostname: url.hostname,
                            path: url.pathname,
                            query: Object.fromEntries(url.searchParams),
                            method,
                            headers: {
                                host: url.host,
                                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                            },
                            body,
                        }),
                    );
                    requestSignal.throwIfAborted();
                    const response = await fetchImpl(url, {
                        method,
                        headers: signed.headers,
                        body,
                        redirect: 'manual',
                        signal: requestSignal,
                    });
                    const result = await response.json();
                    return { http: response.status, result };
                });
            } catch {
                throw new DeployError(
                    'TRANSPORT_UNKNOWN',
                    'Tool request outcome is unknown; inspect the receipt before recovery.',
                    { unknown: true },
                );
            }
        },
        async readFunction(name, { signal } = {}) {
            try {
                return await deadline(signal, async requestSignal => {
                    let found;
                    try {
                        found = await sdk.send(new lambda.GetFunctionConfigurationCommand({ FunctionName: name }), {
                            abortSignal: requestSignal,
                        });
                    } catch (error) {
                        if (error?.name === 'ResourceNotFoundException') return null;
                        throw error;
                    }
                    requestSignal.throwIfAborted();
                    const tags = await sdk.send(new lambda.ListTagsCommand({ Resource: found.FunctionArn }), {
                        abortSignal: requestSignal,
                    });
                    return {
                        functionArn: found.FunctionArn,
                        functionName: found.FunctionName,
                        runtime: found.Runtime,
                        architectures: found.Architectures,
                        handler: found.Handler,
                        role: found.Role,
                        state: found.State,
                        lastUpdateStatus: found.LastUpdateStatus,
                        tags: tags.Tags ?? {},
                    };
                });
            } catch {
                throw new DeployError(
                    'READ_FAILED',
                    'Lambda preflight could not read configuration/tags; no deployment round opened.',
                );
            }
        },
        async put({ url, headers, bytes, signal }) {
            try {
                return await deadline(signal, async requestSignal => {
                    requestSignal.throwIfAborted();
                    const response = await fetchImpl(url, {
                        method: 'PUT',
                        headers,
                        body: bytes,
                        redirect: 'manual',
                        signal: requestSignal,
                    });
                    await response.body?.cancel();
                    return response.status;
                });
            } catch {
                throw new DeployError(
                    'UPLOAD_UNKNOWN',
                    'ZIP upload outcome is unknown; inspect the receipt before recovery.',
                    { unknown: true },
                );
            }
        },
        close() {
            ownedProvider?.close();
            sdk.destroy?.();
        },
    };
}
