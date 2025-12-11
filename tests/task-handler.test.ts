import { describe, expect, test } from "bun:test";
import { BaseTaskData, BasicTaskFn, TaskFNRegistry, TaskHandler, TaskLoggerLike, TaskFn, TempPausedTaskState, StepBasedTaskFn, AbstractTaskHandlerStorageDriver } from "../src/queue/taskHandler";
import { Delay } from "@cleverjs/utils";

type Meta = Record<string, unknown>;
type TaskData = BaseTaskData<Meta>;

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 200, stepMs = 10) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
    throw new Error("Timed out waiting for condition");
};

class FakeInMemoryTaskStorage extends AbstractTaskHandlerStorageDriver<TaskData, {}> {

    private id = 0;
    private tasks = new Map<number, string>();
    private taskStates = new Map<number, string>();

    constructor() {
        super();
    }

    async createTask(data: Omit<TaskData, "id">) {
        this.id += Math.floor(Math.random() * 100) + 1;
        const task = { ...data, id: this.id } as TaskData;
        this.tasks.set(this.id, JSON.stringify(task));
        return this.id;
    }
    async updateTask(data: TaskData) {
        this.tasks.set(data.id, JSON.stringify(data));
    }
    async loadTask(requestedId: number) {
        return JSON.parse(this.tasks.get(requestedId) ?? "null");
    }
    async loadPausedOrPendingTasks() {
        return Array.from(this.tasks.values()).map(t => JSON.parse(t)).filter((t) => t.status === "pending" || t.status === "paused").map((t) => t);
    }
    async loadFinishedTasksWithAutoDelete() {
        return Array.from(this.tasks.values()).map(t => JSON.parse(t)).filter((t) => t.finished_at !== null && t.auto_delete).map((t) => t);
    }
    async deleteTask(requestedId: number) {
        this.tasks.delete(requestedId);
    }

    async loadPausedTaskState(requestedId: number) {
        return JSON.parse(this.taskStates.get(requestedId) ?? "null");
    }
    async savePausedTaskState(requestedId: number, state: TempPausedTaskState) {
        this.taskStates.set(requestedId, JSON.stringify(state));
    }
    async deletePausedTaskState(requestedId: number) {
        this.taskStates.delete(requestedId);
    }

}


const logs: Array<{ level: string; message: string }> = [];
const Logger: TaskLoggerLike = {
    debug: (...args: any[]) => {
        logs.push({ level: "debug", message: args.join(" ") });
        console.debug(...args);
    },
    info: (...args: any[]) => {
        logs.push({ level: "info", message: args.join(" ") }),
            console.info(...args);
    },
    warn: (...args: any[]) => {
        logs.push({ level: "warn", message: args.join(" ") });
        console.warn(...args);
    },
    error: (...args: any[]) => {
        logs.push({ level: "error", message: args.join(" ") });
        console.error(...args);
    },
};

const stepBasedExampleTask = new StepBasedTaskFn("stepBasedExample", async (args: { count: number }, logger, state: TempPausedTaskState & { data: { doneCount: number } }) => {

    state.data = {
        doneCount: 0
    }

    return { success: true };
})
    .addStep("First Long Step", async (args, logger, state, isPaused) => {

        const startingIndex = state.data.doneCount;
        logger.info("Starting First Long Step from index", startingIndex);

        for (let i = startingIndex; i < args.count; i++) {
            if (isPaused.valueOf()) {
                logger.info("Pausing First Long Step at index", i);
                return { success: true, paused: true };
            }
            await Delay.wait(100);
            state.data.doneCount = i + 1;
            logger.info(`First Long Step progress: ${state.data.doneCount}/${args.count}`);
        }

        return { success: true };
    })
    .addStep("Second Long Step", async (args, logger, state, isPaused) => {

        const startingIndex = state.data.doneCount;
        logger.info("Starting Second Long Step from index", startingIndex);

        for (let i = startingIndex; i < args.count; i++) {
            if (isPaused.valueOf()) {
                logger.info("Pausing Second Long Step at index", i);
                return { success: true, paused: true };
            }
            await Delay.wait(100);
            state.data.doneCount = i + 1;
            logger.info(`Second Long Step progress: ${state.data.doneCount}/${args.count}`);
        }
        return { success: true };
    });

const tasksRegistry = new TaskFNRegistry()

    .register("exampleTask", async (args: { example: boolean }, logger) => {

        // logger.info("Running exampleTask with args:", JSON.stringify(args));

        return { success: true };
    })

    .register("willFail", async (args, logger) => {

        // logger.info("Running willFail with args:", JSON.stringify(args));

        return { success: false, message: "This task is meant to fail" };
    })

    .register(stepBasedExampleTask);

const store = new FakeInMemoryTaskStorage();

const createHandler = () => new TaskHandler({
    storage: store,
    defaultLogger: Logger
}, tasksRegistry)

const handler = createHandler();

describe("TaskHandler", () => {
    test("processes an enqueued task and marks it completed", async () => {

        const taskId = await handler.enqueueTask("exampleTask", { example: true });

        await waitFor(async () => {
            const task = (await handler.getTask(taskId) as any)
            console.log("Task status:", task?.status);
            return task?.status === "completed";
        });

        const stored = await handler.getTask(taskId) as any;
        expect(stored?.status).toBe("completed");
        expect(stored?.finished_at).toBeNumber()
    });

    test("marks a task as failed when the function throws", async () => {

        const taskId = await handler.enqueueTask("willFail", { value: 1 });

        await waitFor(async () => (await handler.getTask(taskId) as any)?.status === "failed");

        const stored = await handler.getTask(taskId) as any;
        expect(stored?.status).toBe("failed");
        expect(stored?.finished_at).toBeNumber()
        expect(logs.some((l) => l.level === "error")).toBe(true);
    });

    test("pulls pending tasks from storage when no in-memory queue exists", async () => {

        const pendingId = await store.createTask({
            fn: "exampleTask",
            args: { from: "storage" },
            status: "pending",
            created_at: Date.now(),
        });

        await handler.processQueue();
        await waitFor(async () => (await handler.getTask(pendingId) as any)?.status === "completed");

        const stored = (await handler.getTask(pendingId) as any);
        expect(stored?.status).toBe("completed");
        expect(stored?.finished_at).toBeNumber();
    });

    test("handles step-based tasks with pausing and resuming", async () => {

        const taskId = await handler.enqueueTask("stepBasedExample", { count: 5 });

        await Delay.wait(250);

        await handler.stopProcessing();

        const handler2 = createHandler();

        const stored = await handler.getTask(taskId) as any;
        expect(stored?.status).toBe("paused");

        const pausedState = await store.loadPausedTaskState(taskId);
        expect(pausedState).toBeDefined();
        expect(pausedState?.nextStepToExecute).toBeDefined();
        expect(pausedState?.data.doneCount).toBe(3);

        await handler2.processQueue();

        await waitFor(async () => (await handler.getTask(taskId) as any)?.status === "completed", 5000);
        const finalStored = await handler.getTask(taskId) as any;
        expect(finalStored?.status).toBe("completed");

    });
});

