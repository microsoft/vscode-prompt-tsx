/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function assertNever(value: never, msg = `unexpected value ${value}`): never {
	throw new Error(`Unreachable: ${msg}`);
}
