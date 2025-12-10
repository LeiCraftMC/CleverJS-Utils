import { describe, expect, test } from "bun:test";
import { DataUtils } from "../src/dataUtils";

describe("Data Tests", () => {

    test("Array to Dict Conversion", () => {

        const arr = [
            { fn: "a", val: 1 },
            { fn: "b", val: 2 }
        ] as const;

        const dict = DataUtils.arrayToDict(arr, "fn");

        expect(dict).toEqual({
            a: { fn: "a", val: 1 },
            b: { fn: "b", val: 2 }
        });

    });

});