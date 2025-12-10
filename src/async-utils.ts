/**
 * Assorted async helpers for common control-flow patterns.
 */
export interface TimeoutRaceOptions {
    onTimeout?: () => void;
    message?: string;
    timeoutValue?: any;
    rejectOnTimeout?: boolean;
}

/**
 * Wait for a given amount of milliseconds. Supports AbortSignal for cancellation.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(new Error("Aborted"));
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            /**
             * Assorted async helpers for common control-flow patterns.
             * Provided as static methods on a namespaced class for organized access.
             */

            export interface TimeoutRaceOptions {
                onTimeout?: () => void;
                message?: string;
                timeoutValue?: any;
                rejectOnTimeout?: boolean;
            }

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

            export interface ThrottleOptions {
                leading?: boolean;
                trailing?: boolean;
            }

            export type Throttled<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => void) & {
                cancel: () => void;
                pending: () => boolean;
            };

            export class AsyncUtils {

                /** Race a promise or async function against a timeout with configurable outcome. */
                static raceWithTimeout<T>(input: Promise<T> | (() => Promise<T>), timeout: number, options?: TimeoutRaceOptions): Promise<T> {
                    const target = typeof input === "function" ? (input as () => Promise<T>)() : input;
                    const rejectOnTimeout = options?.rejectOnTimeout ?? true;
                    const message = options?.message ?? `Operation timed out after ${timeout}ms`;
                    const timeoutValue = options?.timeoutValue ?? null;

                    return new Promise<T>((resolve, reject) => {
                        const timer = setTimeout(() => {
                            options?.onTimeout?.();
                            if (rejectOnTimeout) {
                                reject(new Error(message));
                            } else {
                                resolve(timeoutValue as T);
                            }
                        }, timeout);

                        target.then((value) => {
                            clearTimeout(timer);
                            resolve(value);
                        }).catch((error) => {
                            clearTimeout(timer);
                            reject(error);
                        });
                    });
                }

                /** Convenience wrapper that rejects when the timeout wins. */
                static withTimeout<T>(input: Promise<T> | (() => Promise<T>), timeout: number, options?: TimeoutRaceOptions): Promise<T> {
                    return AsyncUtils.raceWithTimeout(input, timeout, { ...options, rejectOnTimeout: true });
                }

                /** Wait for a given amount of milliseconds. Supports AbortSignal for cancellation. */
                static delay(ms: number, signal?: AbortSignal): Promise<void> {
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

                /** Retry an async function with exponential backoff. */
                static async retry<T>(fn: (attempt: number) => Promise<T>, options?: RetryOptions): Promise<T> {
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
                            await AsyncUtils.delay(nextDelay);
                        }
                    }
                }

                /** Debounce a function. Returns a callable with cancel/flush helpers. */
                static debounce<T extends (...args: any[]) => any>(fn: T, wait: number, options?: DebounceOptions): Debounced<T> {
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

                /** Throttle a function to at most one execution per window. */
                static throttle<T extends (...args: any[]) => any>(fn: T, wait: number, options?: ThrottleOptions): Throttled<T> {
                    const leading = options?.leading ?? true;
                    const trailing = options?.trailing ?? true;

                    let lastExecution = 0;
                    let timer: ReturnType<typeof setTimeout> | null = null;
                    let pendingArgs: Parameters<T> | null = null;

                    const invoke = () => {
                        lastExecution = Date.now();
                        if (pendingArgs) {
                            fn(...pendingArgs);
                            pendingArgs = null;
                        }
                    };

                    const throttled = ((...args: Parameters<T>) => {
                        const now = Date.now();
                        if (!leading && lastExecution === 0) {
                            lastExecution = now;
                        }

                        const remaining = wait - (now - lastExecution);
                        pendingArgs = args;

                        if (remaining <= 0) {
                            if (timer) {
                                clearTimeout(timer);
                                timer = null;
                            }
                            if (leading) {
                                invoke();
                            } else if (trailing) {
                                timer = setTimeout(() => {
                                    invoke();
                                    timer = null;
                                }, wait);
                            }
                            return;
                        }

                        if (trailing && !timer) {
                            timer = setTimeout(() => {
                                invoke();
                                timer = null;
                            }, remaining);
                        }
                    }) as Throttled<T>;

                    throttled.cancel = () => {
                        if (timer) {
                            clearTimeout(timer);
                            timer = null;
                        }
                        pendingArgs = null;
                    };

                    throttled.pending = () => timer !== null;

                    return throttled;
                }
            }
        }
