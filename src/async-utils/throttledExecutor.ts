
export interface ThrottleOptions {
    leading?: boolean;
    trailing?: boolean;
}

export type ThrottledExecutor<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => void) & {
    cancel: () => void;
    pending: () => boolean;
};

export interface ThrottledExecutorConstructor {
    new <T extends (...args: any[]) => any>(fn: T, wait: number, options?: ThrottleOptions): ThrottledExecutor<T>;
}

/** Throttle a function to at most one execution per window. */
export const ThrottledExecutor = function <T extends (...args: any[]) => any>(fn: T, wait: number, options?: ThrottleOptions) {
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
    }) as ThrottledExecutor<T>;

    throttled.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        pendingArgs = null;
    };

    throttled.pending = () => timer !== null;

    return throttled;
} as any as ThrottledExecutorConstructor;


