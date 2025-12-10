
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
