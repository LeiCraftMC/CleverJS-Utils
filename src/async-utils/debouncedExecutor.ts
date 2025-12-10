
export interface DebounceOptions {
    leading?: boolean;
    trailing?: boolean;
    maxWait?: number;
}

export type DebouncedExecutor<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => void) & {
    cancel: () => void;
    flush: () => ReturnType<T> | undefined;
    pending: () => boolean;
};

export interface DebouncedExecutorConstructor {
    new <T extends (...args: any[]) => any>(fn: T, wait: number, options?: DebounceOptions): DebouncedExecutor<T>
}

/** Throttle a function to at most one execution per window. */
export const DebouncedExecutor = function <T extends (...args: any[]) => any>(fn: T, wait: number, options?: DebounceOptions) {
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
        }) as DebouncedExecutor<T>;

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
} as any as DebouncedExecutorConstructor;


