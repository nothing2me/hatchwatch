import { createHash, timingSafeEqual } from 'node:crypto';
import { bearerToken } from '@/lib/phones/deviceToken';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

// The live detection worker's shared secret. Refused when WORKER_TOKEN is unset or blank; digests make the lengths equal for timingSafeEqual.
export function workerAuthorized(headers: Headers, expected: string | undefined = process.env.WORKER_TOKEN): boolean
{
    const configured = (expected ?? '').trim();
    const presented = bearerToken(headers) ?? '';
    const same = timingSafeEqual(digest(presented), digest(configured));
    return same && configured.length > 0 && presented.length > 0;
}
