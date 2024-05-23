/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Location, Uri } from "vscode";

/**
 * Arbitrary metadata which can be retrieved after the prompt is rendered.
 */
export abstract class PromptMetadata {
	readonly _marker: undefined;
	toString(): string {
		return Object.getPrototypeOf(this).constructor.name;
	}
}

/**
 * A reference used for creating the prompt.
 */
export class PromptReference {
	constructor(
		readonly anchor: Uri | Location | { variableName: string; value?: Uri | Location },
	) { }
}
