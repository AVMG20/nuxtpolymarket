/**
 * Small helpers the hub and the room share: the token bucket that rate-limits messages and
 * commands, and the one-line error text their logs carry. Every export carries the rt prefix,
 * because Nitro auto-imports server/utils recursively.
 */

/** A token bucket: up to its burst in tokens, refilled continuously at its rate per second. */
export interface RtTokenBucket {
    tokens: number
    at: number
}

export function rtFullBucket(burst: number, now: number): RtTokenBucket {
    return { tokens: burst, at: now }
}

/** Refills the bucket for the time since its last take, then takes one token; false when it has none. */
export function rtTakeToken(bucket: RtTokenBucket, now: number, rate: number, burst: number): boolean {
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, now - bucket.at) * rate / 1000)
    bucket.at = now
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
}

/** An error as one short log line, never its stack. */
export function rtDescribeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'non-error thrown'
}
