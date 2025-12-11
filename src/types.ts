
export type ObjORNull<T> = T | null;

export type Dict<T, K extends string | number = string> = Record<K, T>;

export interface AnyObj extends Dict<any> { }

export type ObjectiveArray<T extends readonly V[], V = unknown> = {
	[K in keyof T as K extends `${number}` ? K : never]: T[K];
};


type UnionToIntersection<U> =
	(U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

type LastOf<T> =
	UnionToIntersection<T extends any ? () => T : never> extends () => (infer R) ? R : never

type ArrayPush<T extends any[], V> = [...T, V];

export type TuplifyUnion<T, L = LastOf<T>, N = [T] extends [never] ? true : false> =
	true extends N ? [] : ArrayPush<TuplifyUnion<Exclude<T, L>>, L>

export type ObjectKeys<T extends Record<any, any>> = TuplifyUnion<keyof T>;


export type Immutable<T> = {
	readonly [P in keyof T]: T[P] extends object ? Immutable<T[P]> : T[P];
};

export type MergeArray<T extends object[]> =
	T extends [infer First, ...infer Rest]
		? First & MergeArray<Rest extends object[] ? Rest : []>
		: {};

export type ArrayToDict<T extends ReadonlyArray<Record<string, any>>, K extends keyof T[number] & (string | number)> = {
	[P in T[number][K] & (string | number)]: Extract<T[number], Record<K, P>>;
};

export type DictToArray<T extends Record<string, any>> = {
	[K in keyof T]: T[K];
}[keyof T][];

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
