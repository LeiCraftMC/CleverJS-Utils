
export interface ThrottleOptions {
    leading?: boolean;
    trailing?: boolean;
}

export type Throttled<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => void) & {
    cancel: () => void;
    pending: () => boolean;
};

/** Throttle a function to at most one execution per window. */
export class ThrottledExecutor<T extends (...args: any[]) => any> {

    protected lastExecution: number;
    protected timer: ReturnType<typeof setTimeout> | null;
    protected pendingArgs: Parameters<T> | null;

    protected options: ThrottleOptions;

    constructor(
        protected fn: T,
        protected wait: number,
        options?: ThrottleOptions
    ) {

        this.options = options || {};
        this.options.leading = this.options.leading ?? true;
        this.options.trailing = this.options.trailing ?? true;

        this.lastExecution = 0;
        this.timer = null;
        this.pendingArgs = null;
    }

    protected invokeFN() {
        this.lastExecution = Date.now();
        if (this.pendingArgs) {
            this.fn(...this.pendingArgs);
            this.pendingArgs = null;
        }
    };

    public run(...args: Parameters<T>) {
        const now = Date.now();
        if (!this.options.leading && this.lastExecution === 0) {
            this.lastExecution = now;
        }

        const remaining = this.wait - (now - this.lastExecution);
        this.pendingArgs = args;

        if (remaining <= 0) {
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }
            if (this.options.leading) {
                this.invokeFN();
            } else if (this.options.trailing) {
                this.timer = setTimeout(() => {
                    this.invokeFN();
                    this.timer = null;
                }, this.wait);
            }
            return;
        }

        if (this.options.trailing && !this.timer) {
            this.timer = setTimeout(() => {
                this.invokeFN();
                this.timer = null;
            }, remaining);
        }
    }

    public cancel() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.pendingArgs = null;
    }

    public pending() {
        return this.timer !== null;
    }
}


