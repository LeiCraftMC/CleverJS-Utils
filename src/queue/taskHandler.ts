export interface TaskLoggerLike {
    debug(...args: any[]): void;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
}

export interface TaskErrorResult {
    success: false;
    message: string;
    data: null;
}
export interface TaskSuccessResult<T> {
    success: true;
    message?: string;
    data: T;
}

export type TaskReturn<T> = TaskSuccessResult<T> | TaskErrorResult;

export type TaskFn = (args: any, logger: TaskLoggerLike) => Promise<TaskReturn<any>>;

export type TaskFnRegistry = Record<string, TaskFn>;

export interface TaskMetaData {
    
}

export interface ExecOptions {
    autoDelete?: boolean;
    storeLogs?: boolean;
}

export interface TaskHandlerSettings<TaskData extends BaseTaskData<AdditionalMeta>, AdditionalMeta extends Record<string, any>> {
    loadTask: (id: number) => Promise<TaskData | null>;
    loadPendingTasks: () => Promise<Array<TaskData>>;
    saveTask: (data: Omit<TaskData, 'id'>) => Promise<number>;

    defaultLogger?: TaskLoggerLike;
    persistentLogger?: TaskLoggerLike;
}

export type BaseTaskData<AdditionalMeta extends Record<string, any>> = AdditionalMeta & {
    id: number;
    fn: string;
    args: any;
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
    created_at: number;
    finished_at?: Date;
}

export class TaskHandler<FNs extends TaskFnRegistry, TaskData extends BaseTaskData<AdditionalMeta>, AdditionalMeta extends Record<string, any>> {

    protected processing = false;
    protected allowedToProcess = true;
    protected pendingTasks: TaskData[] = [];

    constructor(
        protected readonly tasks: FNs,
        protected readonly settings: TaskHandlerSettings<TaskData, AdditionalMeta>
    ) {
        this.settings.defaultLogger = this.settings.defaultLogger || console;
    }

    async enqueueTask<Fn extends keyof FNs>(fn: Fn, args: Parameters<FNs[Fn]>[0], additionalMeta?: AdditionalMeta, execOpts?: ExecOptions): Promise<number> {
        
        const meta = (additionalMeta ?? {}) as AdditionalMeta;
        const taskToSave = {
            ...meta,
            fn: fn as string,
            args,
            status: 'pending',
            created_at: Date.now()
        } as unknown as Omit<TaskData, 'id'>;

        const id = await this.settings.saveTask(taskToSave);

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

    async processQueue() {
        if (this.processing || !this.allowedToProcess) return;
        this.processing = true;

        try {
            if (this.pendingTasks.length === 0) {
                const pending = await this.settings.loadPendingTasks();
                this.pendingTasks.push(...pending);
            }

            while (this.allowedToProcess && this.pendingTasks.length > 0) {
                const nextTask = this.pendingTasks.shift();
                if (!nextTask) continue;
                await this.runTask(nextTask);
            }
        } finally {
            this.processing = false;
        }
    }

    protected async runTask(task: TaskData) {
        const logger = this.settings.persistentLogger || this.settings.defaultLogger || console;
        const fn = this.tasks[task.fn];

        if (!fn) {
            logger.warn(`Task function "${task.fn}" not registered.`);
            return;
        }

        task.status = 'running';

        try {
            const result = await fn(task.args, logger);
            task.status = result.success ? 'completed' : 'failed';
            task.finished_at = new Date();

            if (!result.success) {
                logger.error(result.message);
            }
        } catch (error) {
            task.status = 'failed';
            task.finished_at = new Date();
            logger.error('Task execution failed.', error);
        }
    }

    async stopProcessing() {
        this.allowedToProcess = false;
    }

}
