import { describe, test, expect } from "bun:test";
import { delay, withTimeout, retry, debounce, throttle } from "../src/async-utils";
import { AutoProcessingQueue } from "../src/queue";

const margin = 8;

describe("delay", () => {
    test("resolves after roughly the requested duration", async () => {
        const start = Date.now();
        await delay(25);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(25 - margin);
    });

    test("rejects when aborted", async () => {
        const controller = new AbortController();
        const promise = delay(50, controller.signal);
        controller.abort();
        await expect(promise).rejects.toThrow("Aborted");
    });
});

describe("withTimeout", () => {
    test("resolves before timeout", async () => {
        const result = await withTimeout(Promise.resolve("ok"), 50);
        expect(result).toBe("ok");
    });

    test("rejects when timeout elapses first", async () => {
        await expect(withTimeout(delay(30), 10)).rejects.toThrow("timed out");
    });
});

describe("retry", () => {
    test("retries until success", async () => {
        let attempts = 0;
        const result = await retry(async () => {
            attempts++;
            if (attempts < 3) throw new Error("fail");
            return attempts;
        }, { retries: 3, baseDelay: 5 });

        expect(result).toBe(3);
        expect(attempts).toBe(3);
    });

    test("stops when shouldRetry blocks", async () => {
        let attempts = 0;
        await expect(retry(async () => {
            attempts++;
            throw new Error("blocked");
        }, {
            retries: 3,
            shouldRetry: () => false,
        })).rejects.toThrow("blocked");
        expect(attempts).toBe(1);
    });
});

describe("debounce", () => {
    test("coalesces rapid calls", async () => {
        let count = 0;
        const fn = debounce(() => { count++; }, 20);
        fn();
        fn();
        fn();
        await delay(35);
        expect(count).toBe(1);
    });

    test("supports leading execution", async () => {
        let count = 0;
        const fn = debounce(() => { count++; }, 30, { leading: true, trailing: false });
        fn();
        fn();
        await delay(50);
        expect(count).toBe(1);
    });
});

describe("throttle", () => {
    test("limits executions per window", async () => {
        let count = 0;
        const fn = throttle(() => { count++; }, 25);
        fn();
        fn();
        fn();
        await delay(40);
        expect(count).toBe(2);
    });
});

describe("AutoProcessingQueue", () => {
    test("processes items sequentially", async () => {
        const processed: number[] = [];
        const queue = new AutoProcessingQueue<number>(async (ps) => {
            await delay(5);
            processed.push(ps.data);
        });

        await Promise.all([
            queue.enqueue(1),
            queue.enqueue(2),
            queue.enqueue(3),
        ]);

        expect(processed).toEqual([1, 2, 3]);
    });
});
