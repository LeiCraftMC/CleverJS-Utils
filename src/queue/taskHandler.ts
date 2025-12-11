import { Ref } from "ptr.js";
import { QuickSort } from "../quick-sort";
import { DataUtils } from "../dataUtils";

export interface TaskLoggerLike {
    debug(...args: any[]): void;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
}

export interface TaskErrorResult {
    success: false;
    message: string;
}
export interface TaskSuccessResult {
    success: true;
    message?: string;
}

export type TaskReturn = TaskSuccessResult | TaskErrorResult;

export type StepBasedTaskReturn = (TaskSuccessResult | TaskErrorResult) & {
    paused?: boolean;
}

export interface AbstractTaskFn {
    (args: any, logger: TaskLoggerLike, ...args2: any): Promise<TaskReturn>
}

export interface TaskFn extends AbstractTaskFn {
    fn_name: string;
    isStepBased?: boolean;
}

export interface BasicTaskFn {
    (args: any, logger: TaskLoggerLike): Promise<TaskReturn>;
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

export interface StepBasedTaskFn<Payload = any, State extends TempPausedTaskState = TempPausedTaskState> {
    (args: Payload, logger: TaskLoggerLike, state: State, isPaused: Ref<boolean>): Promise<StepBasedTaskReturn>;
}

export interface SubTaskStepFn<Payload = any, State extends TempPausedTaskState = TempPausedTaskState> {
    (args: Payload, logger: TaskLoggerLike, state: State, isPaused: Ref<boolean>): Promise<StepBasedTaskReturn>;
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

    const fn = async function (args: any, logger: TaskLoggerLike, state: TempPausedTaskState, isPaused: Ref<boolean>): Promise<StepBasedTaskReturn> {

        const startingStep = state?.nextStepToExecute || 0;

        for (let i = startingStep; i < steps.length; i++) {

            state.nextStepToExecute = i;

            if (isPaused.getV()) {
                return { success: true, paused: true };
            }

            const step = steps[i];
            logger.info(`Executing: ${step.description}`);

            const stepResult = await step.fn(args, logger, state, isPaused);
            if (!stepResult.success) {
                return stepResult;
            }
            if (stepResult.paused) {
                // dont update nextStepToExecute, so we can resume here
                return { success: true, paused: true };
            }
        }

        return { success: true, paused: false };
    }

    fn.addStep = function (description: string, stepFn: SubTaskStepFn) {
        steps.push({ description, fn: stepFn });
        return fn;
    }

    fn.fn_name = name;
    fn.isStepBased = true;

    return fn;
} as any as {
    new <Name extends string, RootFN extends SubTaskStepFn>(name: Name, rootStepFN: RootFN):  StepBasedTaskFnInstance<Name, RootFN>;
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
    args: any;
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
    execOptions?: TaskExecOptions;
    created_at: number;
    finished_at?: number;
}

export interface TempPausedTaskState {
    data: any;
    nextStepToExecute: number;
}

export interface TaskHandlerSettings<TaskData extends BaseTaskData<AdditionalMeta>, AdditionalMeta extends Record<string, any>> {
    loadTask: (id: number) => Promise<TaskData | null>;
    loadPausedOrPendingTasks: () => Promise<Array<TaskData>>;
    loadFinishedTasksWithAutoDelete: () => Promise<Array<TaskData>>;
    createTask: (data: Omit<TaskData, 'id'>) => Promise<number>;
    updateTask: (data: TaskData) => Promise<void>;
    deleteTask: (id: number) => Promise<void>;

    savePausedTaskState: (taskID: number, pausedState: TempPausedTaskState) => Promise<void>;
    loadPausedTaskState: (taskID: number) => Promise<TempPausedTaskState | null>;
    deletePausedTaskState: (taskID: number) => Promise<void>;

    defaultLogger?: TaskLoggerLike;
    persistentLogger?: TaskLoggerLike;
}


export class TaskHandler<FNRegistry extends Record<string, TaskFn>, TaskData extends BaseTaskData<AdditionalMeta>, AdditionalMeta extends Record<string, any>> {

    protected processing = false;
    protected isPaused = new Ref<boolean>(false);
    protected pendingTasks: TaskData[] = [];

    protected readonly tasks: FNRegistry;

    constructor(
        protected readonly settings: TaskHandlerSettings<TaskData, AdditionalMeta>,
        tasks: FNRegistry | Array<FNRegistry[keyof FNRegistry]> | TaskFNRegistry<FNRegistry>
    ) {
        this.settings.defaultLogger = this.settings.defaultLogger || console;
        if (tasks instanceof TaskFNRegistry) {
            this.tasks = tasks['registry'];
        } else if (tasks instanceof Array) {
            this.tasks = DataUtils.arrayToDict(tasks, 'fn_name') as any as FNRegistry;
        } else {
            this.tasks = tasks;
        }
    }

    async enqueueTask<Fn extends keyof FNRegistry>(fn: Fn, args: Parameters<FNRegistry[Fn]>[0], additionalMeta?: AdditionalMeta, execOpts?: TaskExecOptions): Promise<number> {

        const meta = (additionalMeta ?? {}) as AdditionalMeta;
        const taskToSave = {
            ...meta,
            fn: fn as string,
            args,
            execOptions: execOpts,
            status: 'pending',
            created_at: Date.now()
        } as unknown as Omit<TaskData, 'id'>;

        const id = await this.settings.createTask(taskToSave);

        const task = await this.settings.loadTask(id);
        if (task) {
            this.pendingTasks.push(task);
        }

        this.processQueue();
        return id;
    }

    async getTask(id: number): Promise<TaskData | null> {
        return await this.settings.loadTask(id);
    }

    private async loadPausedOrPendingTasks(): Promise<Array<TaskData>> {
        const tasks = await this.settings.loadPausedOrPendingTasks();

        // sort so that older tasks are processed first
        return QuickSort.sort(tasks, (base, compare) => {
            return base.created_at - compare.created_at;
        }, true)
    }

    async processQueue() {
        if (this.processing || this.isPaused.getV()) return;
        this.processing = true;

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
        }
    }

    protected async runTask(task: TaskData) {
        const logger = task.execOptions?.storeLogs ? this.settings.persistentLogger || this.settings.defaultLogger! : this.settings.defaultLogger!;
        const fn = this.tasks[task.fn];

        if (!fn) {
            logger.warn(`Task function "${task.fn}" not registered.`);
            return;
        }

        try {
            if (fn.isStepBased) {

                let state = { data: null, nextStepToExecute: 0 };

                const wasPaused = task.status === 'paused';

                if (wasPaused) {

                    const pausedState = await this.settings.loadPausedTaskState(task.id);
                    if (!pausedState) {
                        throw new Error(`Paused state for task ID ${task.id} not found.`);
                    }
                    state = pausedState;

                    logger.info(`Resuming paused task ID ${task.id} from step ${pausedState.nextStepToExecute}...`);
                }

                task.status = 'running';
                const result = await (fn as StepBasedTaskFn)(task.args, logger, state, this.isPaused);

                if (result.paused) {
                    task.status = 'paused';
                    await this.settings.savePausedTaskState(task.id, state);
                    logger.info(`Task ID ${task.id} paused at step ${state.nextStepToExecute}.`);
                } else {
                    if (wasPaused) {
                        await this.settings.deletePausedTaskState(task.id);
                    }
                    task.status = result.success ? 'completed' : 'failed';
                    task.finished_at = Date.now();

                    if (!result.success) {
                        logger.error(result.message);
                    }
                }

            } else {
                task.status = 'running';
                const result = await fn(task.args, logger);
                task.status = result.success ? 'completed' : 'failed';
                task.finished_at = Date.now();

                if (!result.success) {
                    logger.error(result.message);
                }
            }
        } catch (error) {
            task.status = 'failed';
            task.finished_at = Date.now();
            logger.error('Task execution failed.', error);
        }

        await this.settings.updateTask(task);
    }

    async deleteOldCompletedTasks(thresholdInHours: number) {
        const thresholdTime = Date.now() - thresholdInHours * 3600 * 1000;
        const tasks = await this.settings.loadFinishedTasksWithAutoDelete();

        for (const task of tasks) {
            if (task.finished_at && task.finished_at < thresholdTime) {
                await this.settings.deleteTask(task.id);
            }
        }
    }

    async stopProcessing() {
        this.isPaused.setV(true);
    }

}
