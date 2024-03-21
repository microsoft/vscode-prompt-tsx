/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Uri } from 'vscode';
import { PromptReference } from './results';

export type ChatResponsePart = { value: string } | PromptReference;

export interface ChatDocumentContext {
	uri: Uri;
	version: number;
	ranges: Range[];
}
