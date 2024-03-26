/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Uri, Range } from 'vscode';
export type { ChatResponsePart } from 'vscode';

export interface ChatDocumentContext {
	uri: Uri;
	version: number;
	ranges: Range[];
}
