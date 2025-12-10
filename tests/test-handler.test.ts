import { describe, test, expect } from "bun:test";

import { TaskHandler } from "@cleverjs/utils";

const sampleTaskHandler = new TaskHandler(
    {
        "sampleTask": async (args: { testvar: string }, logger) => {
            logger.info(`Task started with arg: ${args.testvar}`);
            return {success: false, message: "Sample task failed", data: null};
        }
    },
    {
        loadTask: async (id: number) => {
            return {
                args: { testvar: "test" },
                created_at: Date.now(),
                fn: "sampleTask",
                id,
                status: "pending"
            };
        },
        loadPendingTasks: async () => [],
        saveTask: async (data) => 1
    }
)

sampleTaskHandler.enqueueTask("sampleTask", {
    testvar: "test"
})

describe("TaskHandler tests", () => {});