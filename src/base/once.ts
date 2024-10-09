/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function once<T extends (...args: any[]) => any>(fn: T): T & { clear: () => void } {
	let result: ReturnType<T>;
	let called = false;

	const wrappedFunction = ((...args: Parameters<T>): ReturnType<T> => {
		if (!called) {
			result = fn(...args);
			called = true;
		}
		return result;
	}) as T & { clear: () => void };

	wrappedFunction.clear = () => {
		called = false;
	};

	return wrappedFunction;
}
