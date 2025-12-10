
/**
 * Represents a cancellable timeout-based task executor that tracks whether the scheduled task has already run or has been cancelled.
 *
 * @remarks
 * Instantiates a delayed operation that executes a provided callback after a specified number of milliseconds. Once cancelled or executed, the schedule is marked as finished to prevent duplicate handling.
 */
export class Schedule {

    private timeout: Timer;
    private finished = false;

    /**
     * Create a new Schedule that will execute the given task after the specified delay.
     * @param task The callback function to execute after the delay.
     * @param ms The delay in milliseconds before executing the task.
     */
    constructor(task: () => void, ms: number) {
        this.timeout = setTimeout(() => {
            this.finished = true;
            task();
        }, ms);
    }

    public cancel() {
        clearTimeout(this.timeout);
        this.finished = true;
    }

    public hasFinished() {
        return this.finished;
    }

}


