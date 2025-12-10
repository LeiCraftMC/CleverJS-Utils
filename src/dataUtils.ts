
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

}