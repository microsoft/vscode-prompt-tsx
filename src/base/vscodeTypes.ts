/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Uri, Location } from 'vscode';
import { PromptReference } from './results';

export type ChatResponsePart = { value: string | Uri | Location } | PromptReference;

export interface ChatDocumentContext {
	uri: Uri;
	version: number;
	ranges: Range[];
}
