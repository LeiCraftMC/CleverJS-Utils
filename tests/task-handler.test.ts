import { describe, expect, test } from "bun:test";

import { BaseTaskData, TaskHandler, TaskLoggerLike } from "../src/queue/taskHandler";

type Meta = Record<string, unknown>;
type TaskData = BaseTaskData<Meta>;

const waitFor = async (predicate: () => boolean, timeoutMs = 200, stepMs = 10) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
    throw new Error("Timed out waiting for condition");
};

const createStore = () => {
    let id = 0;
    const tasks = new Map<number, TaskData>();

    return {
        tasks,
        async saveTask(data: Omit<TaskData, "id">) {
            id += 1;
            const task = { ...data, id } as TaskData;
            tasks.set(id, task);
            return id;
        },
        async loadTask(requestedId: number) {
            return tasks.get(requestedId) ?? null;
        },
        async loadPendingTasks() {
            return Array.from(tasks.values()).filter((t) => t.status === "pending");
        },
    };
};

const createLogger = () => {
    const logs: Array<{ level: string; message: string }> = [];
    const logger: TaskLoggerLike = {
        debug: (...args: any[]) => logs.push({ level: "debug", message: args.join(" ") }),
        info: (...args: any[]) => logs.push({ level: "info", message: args.join(" ") }),
        warn: (...args: any[]) => logs.push({ level: "warn", message: args.join(" ") }),
        error: (...args: any[]) => logs.push({ level: "error", message: args.join(" ") }),
    };
    return { logger, logs };
};

describe("TaskHandler", () => {
    test("processes an enqueued task and marks it completed", async () => {
        const { tasks, saveTask, loadTask, loadPendingTasks } = createStore();
        const { logger } = createLogger();

        const handler = new TaskHandler(
            {
                run: async (_args) => ({ success: true, data: null }),
            },
            { loadTask, loadPendingTasks, saveTask, defaultLogger: logger }
        );

        const taskId = await handler.enqueueTask("run", { example: true });

        await waitFor(() => tasks.get(taskId)?.status === "completed");

        const stored = tasks.get(taskId);
        expect(stored?.status).toBe("completed");
        expect(stored?.finished_at).toBeInstanceOf(Date);
    });

    test("marks a task as failed when the function throws", async () => {
        const { tasks, saveTask, loadTask, loadPendingTasks } = createStore();
        const { logger, logs } = createLogger();

        const handler = new TaskHandler(
            {
                fail: async (_args) => {
                    throw new Error("boom");
                },
            },
            { loadTask, loadPendingTasks, saveTask, defaultLogger: logger }
        );

        const taskId = await handler.enqueueTask("fail", { value: 1 });

        await waitFor(() => tasks.get(taskId)?.status === "failed");

        const stored = tasks.get(taskId);
        expect(stored?.status).toBe("failed");
        expect(stored?.finished_at).toBeInstanceOf(Date);
        expect(logs.some((l) => l.level === "error")).toBe(true);
    });

    test("pulls pending tasks from storage when no in-memory queue exists", async () => {
        const { tasks, saveTask, loadTask, loadPendingTasks } = createStore();
        const { logger } = createLogger();

        const handler = new TaskHandler(
            {
                run: async (_args) => ({ success: true, data: null }),
            },
            { loadTask, loadPendingTasks, saveTask, defaultLogger: logger }
        );

        const pendingId = await saveTask({
            fn: "run",
            args: { from: "storage" },
            status: "pending",
            created_at: Date.now(),
        });

        await handler.processQueue();
        await waitFor(() => tasks.get(pendingId)?.status === "completed");

        expect(tasks.get(pendingId)?.status).toBe("completed");
    });
});


describe("TaskHandler tests", () => {});