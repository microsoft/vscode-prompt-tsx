/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Location, ThemeIcon, Uri } from "vscode";

/**
 * Arbitrary metadata which can be retrieved after the prompt is rendered.
 */
export abstract class PromptMetadata {
	readonly _marker: undefined;
	toString(): string {
		return Object.getPrototypeOf(this).constructor.name;
	}
}

export enum ChatResponseReferencePartStatusKind {
	Complete = 1,
	Partial = 2,
	Omitted = 3
}

/**
 * A reference used for creating the prompt.
 */
export class PromptReference {
	constructor(
		readonly anchor: Uri | Location | { variableName: string; value?: Uri | Location },
		readonly iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri },
		readonly options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } }
	) { }
}
