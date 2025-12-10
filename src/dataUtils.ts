import { ArrayToDict, MergeArray } from "./types";

export class DataUtils {

    public sortObjectAlphabetical<T extends Object>(obj: T): T {
        const deepSort = (input: any): any => {
            if (typeof input !== 'object' || input === null) {
                return input;
            }

            if (Array.isArray(input)) {
                return input.map(deepSort);
            }

            const sortedObj: Dict<any> = {};
            Object.keys(input)
                .sort()
                .forEach(key => {
                    sortedObj[key] = deepSort(input[key]);
                });
            return sortedObj;
        };

        const sortedObj = deepSort(obj);
        return sortedObj;
    }

    static replaceAtIndex(str: string, searchValue: string, replaceValue: string, index: number) {
        if (index < 0 || index >= str.length) {
            return str;
        }
        const nextIndex = str.indexOf(searchValue, index);
        if (nextIndex === -1) {
            return str;
        }
        return str.substring(0, nextIndex) + replaceValue + str.substring(nextIndex + searchValue.length);
    }

    static mergeObjects<T extends object[]>(...objects: T): MergeArray<T> {
        return Object.assign({}, ...objects) as MergeArray<T>;
    }

    static arrayToDict<T extends ReadonlyArray<Record<string, any>>, K extends keyof T[number] & string>(arr: T, key: K): ArrayToDict<T, K> {
        const dict = {} as ArrayToDict<T, K>;
        for (const item of arr) {
            const dictKey = item[key];
            (dict as any)[dictKey] = item;
        }
        return dict;
    }

}