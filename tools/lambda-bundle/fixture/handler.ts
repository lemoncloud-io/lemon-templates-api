import { createHash } from 'node:crypto';

interface LabEvent {
    action?: 'calculate' | 'throw';
    values?: number[];
}

interface LabContext {
    awsRequestId?: string;
}

let invocationCount = 0;

function summarizeValues(values: number[]): number {
    return values.reduce((total, value) => total + value * value, 0);
}

function deliberateFailure(): never {
    throw new Error('BUNDLE_LAB_EXPECTED_ERROR'); // ORIGINAL_THROW_MARKER
}

export async function lambda(event: LabEvent = {}, context: LabContext = {}) {
    invocationCount += 1;
    if (event.action === 'throw') deliberateFailure();
    const total = summarizeValues(event.values ?? [2, 3, 5]);
    return {
        label: 'bundle-lab',
        total,
        checksum: createHash('sha256').update(String(total)).digest('hex'),
        invocationCount,
        requestId: context.awsRequestId ?? 'standalone',
    };
}
