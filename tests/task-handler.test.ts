import { describe, expect, test } from "bun:test";
import { BaseTaskData, BasicTaskFn, TaskFNRegistry, TaskHandler, TaskLoggerLike, TaskFn, TempPausedTaskState, StepBasedTaskFn } from "../src/queue/taskHandler";
import { Delay } from "@cleverjs/utils";

type Meta = Record<string, unknown>;
type TaskData = BaseTaskData<Meta>;

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 200, stepMs = 10) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
    throw new Error("Timed out waiting for condition");
};

const createStore = () => {
    let id = 0;
    const tasks = new Map<number, string>();
    const taskStates = new Map<number, string>();

    return {
        tasks,
        async createTask(data: Omit<TaskData, "id">) {
            id += Math.floor(Math.random() * 100) + 1;
            const task = { ...data, id } as TaskData;
            tasks.set(id, JSON.stringify(task));
            return id;
        },
        async updateTask(data: TaskData) {
            tasks.set(data.id, JSON.stringify(data));
        },
        async loadTask(requestedId: number) {
            return JSON.parse(tasks.get(requestedId) ?? "null");
        },
        async loadPausedOrPendingTasks() {
            return Array.from(tasks.values()).map(t => JSON.parse(t)).filter((t) => t.status === "pending" || t.status === "paused").map((t) => t);
        },
        async loadFinishedTasksWithAutoDelete() {
            return Array.from(tasks.values()).map(t => JSON.parse(t)).filter((t) => t.finished_at !== null && t.auto_delete).map((t) => t);
        },
        async deleteTask(requestedId: number) {
            tasks.delete(requestedId);
        },

        async loadPausedTaskState(requestedId: number) {
            return JSON.parse(taskStates.get(requestedId) ?? "null");
        },
        async savePausedTaskState(requestedId: number, state: TempPausedTaskState) {
            taskStates.set(requestedId, JSON.stringify(state));
        },
        async deletePausedTaskState(requestedId: number) {
            taskStates.delete(requestedId);
        }
    };
};


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

    logger.info("Running exampleTask with args:", JSON.stringify(args));

    return { success: true, data: args };
})

.register("willFail", async (args, logger) => {

    logger.info("Running willFail with args:", JSON.stringify(args));

    return { success: false, message: "This task is meant to fail" };
})

.register(stepBasedExampleTask);

const { tasks: tasksStore, createTask, updateTask, loadTask, loadPausedOrPendingTasks, deleteTask, loadFinishedTasksWithAutoDelete, loadPausedTaskState, savePausedTaskState, deletePausedTaskState } = createStore();

const createHandler = () => new TaskHandler({
    loadTask,
    loadPausedOrPendingTasks,
    loadFinishedTasksWithAutoDelete,
    createTask,
    updateTask,
    deleteTask,

    loadPausedTaskState,
    savePausedTaskState,
    deletePausedTaskState,

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
        expect(stored?.finished_at).toBeInstanceOf(Date);
    });

    test("marks a task as failed when the function throws", async () => {

        const taskId = await handler.enqueueTask("willFail", { value: 1 });

        await waitFor(async () => (await handler.getTask(taskId) as any)?.status === "failed");

        const stored = await handler.getTask(taskId) as any;
        expect(stored?.status).toBe("failed");
        expect(stored?.finished_at).toBeInstanceOf(Date);
        expect(logs.some((l) => l.level === "error")).toBe(true);
    });

    test("pulls pending tasks from storage when no in-memory queue exists", async () => {

        const pendingId = await createTask({
            fn: "exampleTask",
            args: { from: "storage" },
            status: "pending",
            created_at: Date.now(),
        });

        await handler.processQueue();
        await waitFor(async () => (await handler.getTask(pendingId) as any)?.status === "completed");

        expect((await handler.getTask(pendingId) as any)?.status).toBe("completed");
    });

    test("handles step-based tasks with pausing and resuming", async () => {

        const taskId = await handler.enqueueTask("stepBasedExample", { count: 5 });

        await Delay.wait(250);

        await handler.stopProcessing();

        const handler2 = createHandler();

        const stored = await handler.getTask(taskId) as any;
        expect(stored?.status).toBe("paused");

        await handler2.processQueue();

        await waitFor(async () => (await handler.getTask(taskId) as any)?.status === "completed", 5000);
        const finalStored = await handler.getTask(taskId) as any;
        expect(finalStored?.status).toBe("completed");

    });
});

