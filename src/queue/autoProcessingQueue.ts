import { Deferred } from "../async-utils/deferred.js";
import { Queue } from "./basic.js";

export class ProcessState<T> {
    constructor(
        public data: T,
        readonly proccessed = new Deferred()
    ) {}
}

export class AutoProcessingQueue<T> {

    protected queue = new Queue<ProcessState<T>>();
    protected processing = false;

    constructor(
        protected readonly process: (ps: ProcessState<T>) => Promise<void>
    ) {}

    public async enqueue(data: T) {
        const ps = new ProcessState(data);
        this.queue.enqueue(ps);
        this.processAll();
        return ps.proccessed;
    }

    public front() { return this.queue.front(); }
    public back() { return this.queue.back(); }

    protected async processAll() {
        if (this.processing || this.queue.size === 0) return;
        this.processing = true;

        while (this.queue.size > 0) {
            const ps = this.queue.dequeue() as ProcessState<T>;
            try {
                await this.process(ps);
                ps.proccessed.resolve(undefined);
            } catch (error) {
                ps.proccessed.reject(error);
            }
            await ps.proccessed;
        }

        this.processing = false;
    }

}
