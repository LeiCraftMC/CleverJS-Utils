/**
 * Assorted async helpers for common control-flow patterns.
 * Provided as static methods on a namespaced class for organized access.
 */

export interface RetryOptions {
    retries?: number;
    baseDelay?: number;
    factor?: number;
    maxDelay?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
    onRetry?: (error: unknown, attempt: number, nextDelay: number) => void | Promise<void>;
}

export interface DebounceOptions {
    leading?: boolean;
    trailing?: boolean;
    maxWait?: number;
}

export type Debounced<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => void) & {
    cancel: () => void;
    flush: () => ReturnType<T> | undefined;
    pending: () => boolean;
};



/** Wait for a given amount of milliseconds. Supports AbortSignal for cancellation. */
export class Delay {
    static wait(ms: number, signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) {
            return Promise.reject(new Error("Aborted"));
        }

        return new Promise((resolve, reject) => {
            const onAbort = () => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
                reject(new Error("Aborted"));
            };

            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, ms);

            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }
}

/** Retry an async function with exponential backoff. */
export class Retry {
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

/** Debounce a function. Returns a callable with cancel/flush helpers. */
export class Debounce {
    static create<T extends (...args: any[]) => any>(fn: T, wait: number, options?: DebounceOptions): Debounced<T> {
        const leading = options?.leading ?? false;
        const trailing = options?.trailing ?? true;
        const maxWait = options?.maxWait;

        let timer: ReturnType<typeof setTimeout> | null = null;
        let lastInvokeTime = 0;
        let lastCallTime = 0;
        let lastArgs: Parameters<T> | null = null;
        let lastResult: ReturnType<T> | undefined;

        const invoke = () => {
            lastInvokeTime = Date.now();
            if (lastArgs) {
                lastResult = fn(...lastArgs);
                lastArgs = null;
            }
        };

        const startTimer = () => {
            const timeSinceLastInvoke = Date.now() - lastInvokeTime;
            const timeSinceLastCall = Date.now() - lastCallTime;
            const remaining = wait - timeSinceLastCall;
            const maxRemaining = maxWait !== undefined ? maxWait - timeSinceLastInvoke : remaining;
            const timeout = maxWait !== undefined ? Math.min(remaining, maxRemaining) : remaining;

            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                if (trailing && lastArgs) {
                    invoke();
                }
            }, Math.max(0, timeout));
        };

        const debounced = ((...args: Parameters<T>) => {
            lastCallTime = Date.now();
            lastArgs = args;

            const shouldInvokeLeading = leading && !timer;
            const reachedMaxWait = maxWait !== undefined && Date.now() - lastInvokeTime >= maxWait;

            if (shouldInvokeLeading) {
                invoke();
            }

            if (reachedMaxWait) {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (trailing) {
                    invoke();
                }
                return;
            }

            startTimer();
        }) as Debounced<T>;

        debounced.cancel = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            lastArgs = null;
        };

        debounced.flush = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (lastArgs) {
                invoke();
            }
            return lastResult;
        };

        debounced.pending = () => timer !== null;

        return debounced;
    }
}

