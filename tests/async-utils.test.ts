import { describe, test, expect } from "bun:test";
import { Delay, Retry, Debounce, Throttle } from "../src/async-utils";
import { BoundedExecutor } from "../src/boundedExecutor";
import { AutoProcessingQueue } from "../src/queue";

const margin = 8;

describe("delay", () => {
    test("resolves after roughly the requested duration", async () => {
        const start = Date.now();
        await Delay.wait(25);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(25 - margin);
    });

    test("rejects when aborted", async () => {
        const controller = new AbortController();
        const promise = Delay.wait(50, controller.signal);
        controller.abort();
        await expect(promise).rejects.toThrow("Aborted");
    });
});

describe("BoundedExecutor", () => {
    test("resolves before timeout", async () => {
        const result = await new BoundedExecutor(async () => "ok", 50);
        expect(result).toBe("ok");
    });

    test("rejects when timeout elapses first", async () => {
        const err = await new BoundedExecutor(async () => {
            await Delay.wait(30);
            return "done";
        }, 10).catch(e => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as any as Error).message).toBe("Operation timed out");
    });

    test("returns null when dontThrowOnTimeout is true", async () => {
        const result = await new BoundedExecutor(async () => {
            await Delay.wait(30);
            return "done";
        }, 10, undefined, true);
        expect(result).toBeNull();
    });
});

describe("retry", () => {
    test("retries until success", async () => {
        let attempts = 0;
        const result = await Retry.run(async () => {
            attempts++;
            if (attempts < 3) throw new Error("fail");
            return attempts;
        }, { retries: 3, baseDelay: 5 });

        expect(result).toBe(3);
        expect(attempts).toBe(3);
    });

    test("stops when shouldRetry blocks", async () => {
        let attempts = 0;
        await expect(Retry.run(async () => {
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
        const fn = Debounce.create(() => { count++; }, 20);
        fn();
        fn();
        fn();
        await Delay.wait(35);
        expect(count).toBe(1);
    });

    test("supports leading execution", async () => {
        let count = 0;
        const fn = Debounce.create(() => { count++; }, 30, { leading: true, trailing: false });
        fn();
        fn();
        await Delay.wait(50);
        expect(count).toBe(1);
    });
});

describe("throttle", () => {
    test("limits executions per window", async () => {
        let count = 0;
        const fn = Throttle.create(() => { count++; }, 25);
        fn();
        fn();
        fn();
        await Delay.wait(40);
        expect(count).toBe(2);
    });
});

describe("AutoProcessingQueue", () => {
    test("processes items sequentially", async () => {
        const processed: number[] = [];
        const queue = new AutoProcessingQueue<number>(async (ps) => {
            await Delay.wait(5);
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
