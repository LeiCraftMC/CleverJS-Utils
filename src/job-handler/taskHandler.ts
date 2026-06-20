import { Ref } from "ptr.js";
import { QuickSort } from "../quick-sort";
import { DataUtils } from "../dataUtils";
import { Deferred } from "../async-utils/deferred";
import { Optional } from "../types";



export class TaskHandler<
    FNRegistry extends Record<string, TaskHandler.TaskFn>,
    StorageDriver extends TaskHandler.AbstractStorageDriver<TaskData, AdditionalMeta>,
    TaskData extends TaskHandler.BaseTaskData<AdditionalMeta>,
    AdditionalMeta extends Record<string, any>,
> {

    protected processing = false;
    protected processingWait = new Deferred<void>().resolve();

    protected isPaused = new Ref<boolean>(false);
    protected pendingTasks: TaskData[] = [];

    protected readonly storage: StorageDriver;

    protected readonly tasks: FNRegistry;

    constructor(
        protected readonly settings: TaskHandler.Settings<TaskData, AdditionalMeta, StorageDriver>,
        tasks: FNRegistry | Array<FNRegistry[keyof FNRegistry]> | TaskHandler.TaskFNRegistry<FNRegistry>
    ) {
        this.storage = settings.storage;
        this.settings.defaultLogger = this.settings.defaultLogger || console;

        if (tasks instanceof TaskHandler.TaskFNRegistry) {
            this.tasks = tasks['registry'];
        } else if (tasks instanceof Array) {
            this.tasks = DataUtils.arrayToDict(tasks, 'fn_name') as any as FNRegistry;
        } else {
            this.tasks = tasks;
        }
    }

    async enqueueTask<Fn extends keyof FNRegistry>(fn: Fn, args: Parameters<FNRegistry[Fn]>[0], additionalMeta: AdditionalMeta, execOpts?: TaskHandler.TaskExecOptions): Promise<number> {

        const meta = additionalMeta;
        const taskToSave = {
            ...meta,
            fn: fn as string,
            args,
            execOptions: execOpts || null,
            status: 'pending',
            created_at: Date.now(),
            finished_at: null,
            result: null,
            message: null
        } as any as Omit<TaskData, 'id'>;

        const id = await this.storage.createTask(taskToSave);

        const task = await this.storage.loadTask(id);
        if (task) {
            this.pendingTasks.push(task);
        }

        this.processQueue();
        return id;
    }

    async getTask(id: number): Promise<TaskData | null> {
        return await this.storage.loadTask(id);
    }

    private async loadPausedOrPendingTasks(): Promise<Array<TaskData>> {
        const tasks = await this.storage.loadPausedOrPendingTasks();

        // sort so that older tasks are processed first
        return QuickSort.sort(tasks, (base, compare) => {
            return base.created_at - compare.created_at;
        }, true)
    }

    async processQueue() {
        if (this.processing || this.isPaused.getV()) return
        this.processing = true;
        this.processingWait = new Deferred<void>();

        try {
            if (this.pendingTasks.length === 0) {
                const pending = await this.loadPausedOrPendingTasks();
                this.pendingTasks.push(...pending);
            }

            while (!this.isPaused.getV() && this.pendingTasks.length > 0) {
                const nextTask = this.pendingTasks.shift();
                if (!nextTask) continue;
                await this.runTask(nextTask);
            }
        } finally {
            this.processing = false;
            this.processingWait.resolve();
        }
    }

    protected async runTask(task: TaskData) {
        const logger = task.execOptions?.storeLogs ? new this.settings.persistentLogger!(task.id) : this.settings.defaultLogger! as TaskHandler.TaskLoggerLike;
        const fn = this.tasks[task.fn];

        if (!fn) {
            logger.warn(`Task function "${task.fn}" not registered.`);
            return;
        }

        try {
            if (fn.isStepBased) {

                let state = { data: {}, nextStepToExecute: 0 };

                const wasPaused = task.status === 'paused';

                if (wasPaused) {

                    const pausedState = await this.storage.loadPausedTaskState(task.id);
                    if (!pausedState) {
                        throw new Error(`Paused state for task ID ${task.id} not found.`);
                    }
                    state = pausedState;

                    logger.info(`Resuming paused task ID ${task.id} from step ${pausedState.nextStepToExecute}...`);
                }

                task.status = 'running';
                const result = await (fn as TaskHandler.StepBasedTaskFn)(task.args, logger, state, this.isPaused);

                if (result.paused) {
                    task.status = 'paused';
                    await this.storage.savePausedTaskState(task.id, state);
                    logger.info(`Task ID ${task.id} paused at step ${state.nextStepToExecute}.`);
                } else {
                    if (wasPaused) {
                        await this.storage.deletePausedTaskState(task.id);
                    }
                    task.status = result.success ? 'completed' : 'failed';
                    task.finished_at = Date.now();
                    task.result = result.success ? result.data : null;
                    task.message = result.message || null;
                }

            } else {
                task.status = 'running';
                const result = await fn(task.args, logger);
                task.status = result.success ? 'completed' : 'failed';
                task.finished_at = Date.now();
                task.result = result.success ? result.data : null;
                task.message = result.message || null;

            }
        } catch (error) {
            task.status = 'failed';
            task.finished_at = Date.now();
            task.result = null;
            task.message = null;
            logger.error('Task execution failed.', error);
        }

        await this.storage.updateTask(task);
        
        // @ts-ignore
        if (logger.type === 'persistent') {
            // @ts-ignore
            await logger.close();
        }
    }

    async deleteOldCompletedTasks(thresholdInHours: number) {
        const thresholdTime = Date.now() - thresholdInHours * 3600 * 1000;
        const tasks = await this.storage.loadFinishedTasksWithAutoDelete();

        for (const task of tasks) {
            if (task.finished_at && task.finished_at < thresholdTime) {
                await this.storage.deleteTask(task.id);
            }
        }
    }

    async stopProcessing() {
        this.isPaused.setV(true);
        await this.processingWait;
    }

    async resumeProcessing() {
        if (!this.isPaused.getV()) return;
        this.isPaused.setV(false);
        await this.processQueue();
    }

}

export namespace TaskHandler {

    export interface BasicTaskLoggerLike {
        debug(...args: any[]): void;
        info(...args: any[]): void;
        warn(...args: any[]): void;
        error(...args: any[]): void;
    }

    export interface PersistentTaskLoggerLike extends BasicTaskLoggerLike {
        readonly type: 'persistent';
        close(): Promise<void>;
    }

    export interface PersistentTaskLoggerConstructorLike {
        new (taskID: number): PersistentTaskLoggerLike;
    }

    export type TaskLoggerLike = BasicTaskLoggerLike | PersistentTaskLoggerLike

    export interface TaskErrorResult {
        success: false;
        message: string;
    }
    export interface TaskSuccessResult<T> {
        success: true;
        message?: string;
        data?: T;
    }

    export type TaskReturn<T> = TaskSuccessResult<T> | TaskErrorResult;

    export type StepBasedTaskReturn = (Optional<TaskSuccessResult<any>, "data"> | TaskErrorResult) & {
        paused?: boolean;
    }

    export interface AbstractTaskFn {
        (args: any, logger: BasicTaskLoggerLike, ...args2: any): Promise<TaskReturn<any>>
    }

    export interface TaskFn extends AbstractTaskFn {
        fn_name: string;
        isStepBased?: boolean;
    }

    export interface BasicTaskFn {
        (args: any, logger: BasicTaskLoggerLike): Promise<TaskReturn<any>>;
    }

    export const BasicTaskFn = function (name: string, fn: BasicTaskFn) {
        return Object.assign(fn, {
            fn_name: name
        });
    } as any as {
        new <Name extends string, FN extends BasicTaskFn>(name: Name, fn: FN): FN & {
            fn_name: Name
        };
    }

    export interface StepBasedTaskFn<Payload = any, StateData extends Record<string, any> = any> {
        (args: Payload, logger: BasicTaskLoggerLike, state: TempPausedTaskState<StateData>, isPaused: Ref<boolean>): Promise<StepBasedTaskReturn>;
    }

    export interface SubTaskStepFn<Payload = any, StateData extends Record<string, any> = any> {
        (args: Payload, logger: BasicTaskLoggerLike, state: StateData, isPaused: Ref<boolean>): Promise<StepBasedTaskReturn>;
    }

    type StepBasedTaskFnInstance<Name extends string, RootFN extends SubTaskStepFn> = StepBasedTaskFn<Parameters<RootFN>[0], Parameters<RootFN>[2]> & {
        fn_name: Name;
        isStepBased: true
        addStep(description: string, stepFn: SubTaskStepFn<Parameters<RootFN>[0], Parameters<RootFN>[2]>): StepBasedTaskFnInstance<Name, RootFN>;
    };

    export const StepBasedTaskFn = function (name: string, rootStepFN: SubTaskStepFn) {

        const steps: Array<{
            description: string;
            fn: SubTaskStepFn;
            pausable?: boolean;
        }> = [{
            description: "Initial Step",
            fn: rootStepFN
        }];

        const fn = async function (args: any, logger: BasicTaskLoggerLike, state: TempPausedTaskState<any>, isPaused: Ref<boolean>): Promise<StepBasedTaskReturn> {

            const startingStep = state?.nextStepToExecute || 0;

            for (let i = startingStep; i < steps.length; i++) {

                state.nextStepToExecute = i;

                if (isPaused.getV()) {
                    return { success: true, paused: true };
                }

                const step = steps[i];
                logger.info(`Executing: ${step.description}`);

                const stepResult = await step.fn(args, logger, state.data, isPaused);
                if (!stepResult.success) {
                    return stepResult;
                }

                if (stepResult.paused) {
                    // dont update nextStepToExecute, so we can resume here
                    return { success: true, paused: true };
                }

                const isLast = i === (steps.length - 1);
                if (isLast) {
                    return { success: true, paused: false };
                }
            }

            return { success: true, data: null, paused: false };
        }

        fn.addStep = function (description: string, stepFn: SubTaskStepFn) {
            steps.push({ description, fn: stepFn });
            return fn;
        }

        fn.fn_name = name;
        fn.isStepBased = true;

        return fn;
    } as any as {
        new <Name extends string, RootFN extends SubTaskStepFn>(name: Name, rootStepFN: RootFN): StepBasedTaskFnInstance<Name, RootFN>;
    }



    export class TaskFNRegistry<Registry extends {}> {

        constructor(
            protected readonly registry: Registry = {} as Registry
        ) { }

        public register<Name extends string, FN extends BasicTaskFn>(name: Name, fn: FN): TaskFNRegistry<Registry & {
            [K in Name]: FN & { fn_name: Name }
        }>;
        // public register<Name extends string, RootFN extends BasicTaskFn>(name: Name, rootFn: RootFN, stepBased: boolean): TaskFNRegistry<Registry & {
        //     [K in Name]: StepBasedTaskFn<Parameters<RootFN>[0]> & {
        //         fn_name: Name,
        //         isStepBased: true
        //     }
        // }>;
        public register<Name extends string, FN extends TaskFn>(fn: FN): TaskFNRegistry<Registry & {
            [K in FN["fn_name"]]: FN
        }>;

        public register<Name extends string, FN extends TaskFn>(nameOrFN: Name | FN, fn?: FN) {

            if ((typeof nameOrFN === "function" || typeof nameOrFN === "object") && ("fn_name" in nameOrFN)) {

                (this.registry as any)[nameOrFN["fn_name"]] = nameOrFN;

            } else if (fn) {

                return this.register(new BasicTaskFn(nameOrFN as Name, fn));

            } else {
                throw new Error("Invalid arguments to register method.");
            }
            return this;
        }

    }


    export interface TaskExecOptions {
        autoDelete?: boolean;
        storeLogs?: boolean;
    }

    export type BaseTaskData<AdditionalMeta extends Record<string, any>> = AdditionalMeta & {
        id: number;
        fn: string;
        args: Record<string, any>;
        status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
        execOptions: TaskExecOptions | null;
        created_at: number;
        finished_at: number | null;
        result: Record<string, any> | null;
        message: string | null;
    }

    export interface TempPausedTaskState<T extends Record<string, any> = Record<string, any>> {
        data: T;
        nextStepToExecute: number;
    }

    export abstract class AbstractStorageDriver<TaskData extends BaseTaskData<AdditionalMeta>, AdditionalMeta extends Record<string, any>> {

        abstract loadTask(id: number): Promise<TaskData | null>;
        abstract loadPausedOrPendingTasks(): Promise<Array<TaskData>>;
        abstract loadFinishedTasksWithAutoDelete(): Promise<Array<TaskData>>;
        abstract createTask(data: Omit<TaskData, 'id'>): Promise<number>;
        abstract updateTask(data: TaskData): Promise<void>;
        abstract deleteTask(id: number): Promise<void>;

        abstract savePausedTaskState(taskID: number, pausedState: TempPausedTaskState): Promise<void>;
        abstract loadPausedTaskState(taskID: number): Promise<TempPausedTaskState | null>;
        abstract deletePausedTaskState(taskID: number): Promise<void>;
    }

    export interface Settings<TaskData extends BaseTaskData<AdditionalMeta>, AdditionalMeta extends Record<string, any>, StorageDriver extends AbstractStorageDriver<TaskData, AdditionalMeta>> {
        storage: StorageDriver;
        defaultLogger?: BasicTaskLoggerLike;
        persistentLogger?: PersistentTaskLoggerConstructorLike;
    }


}