import { LinkedList } from "../linked-list.js";

export class Queue<T> {
    
    protected list = new LinkedList<T>()

    public get size() { return this.list.size; }

    public enqueue(data: T) {
        this.list.addLast(data);
    }

    public dequeue() {
        const data = this.list.getFirst() || null;
        this.list.removeFirst();
        return data;
    }

    public front() { return this.list.getFirst(); }
    public back() { return this.list.getLast(); }

    public clear() { this.list.clear(); }

    public values() { return this.list.values(); }
    public [Symbol.iterator]() { return this.values(); }


    get [Symbol.toStringTag]() { return this.constructor.name; }
    [Symbol.toPrimitive](hint: "string") { return this.list.toString(); }
    [Symbol.for('nodejs.util.inspect.custom')]() { return this.list.toString(); }

}


