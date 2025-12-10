/**
 * Assorted async helpers for common control-flow patterns.
 * Provided as static methods on a namespaced class for organized access.
 */

import { Delay } from "../delay";

export interface RetryOptions {
    retries?: number;
    baseDelay?: number;
    factor?: number;
    maxDelay?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
    onRetry?: (error: unknown, attempt: number, nextDelay: number) => void | Promise<void>;
}

/** Retry an async function with exponential backoff. */
export class AsyncRetry {
    static async run<T>(fn: (attempt: number) => Promise<T>, options?: RetryOptions): Promise<T> {
        const {
            retries = 3,
            baseDelay = 100,
            factor = 2,
            maxDelay = Number.POSITIVE_INFINITY,
            shouldRetry,
            onRetry,
        } = options ?? {};

        let attempt = 0;

        while (true) {
            attempt++;
            try {
                return await fn(attempt);
            } catch (error) {
                const should = await (shouldRetry ? shouldRetry(error, attempt) : true);
                if (!should || attempt > retries) {
                    throw error;
                }

                const nextDelay = Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
                await onRetry?.(error, attempt, nextDelay);
                await Delay.wait(nextDelay);
            }
        }
    }
}


