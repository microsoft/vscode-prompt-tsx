/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, InteractiveEditorProgressItem, InteractiveEditorReplyFollowup, Location, Progress, Range, TextEdit, Uri, WorkspaceEdit } from "vscode";

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

export type ReplyInterpreterFactory = (progress: ReplyInterpreterProgress, streamEdits: boolean) => ReplyInterpreter;
export type ReplyInterpreterProgress = Progress<InteractiveEditorProgressItem>;
export interface ReplyInterpreter {
	update(newText: string): { shouldFinish: boolean };
	finish(): Promise<IParsedReply>;
}

export interface IInlineEditReply {
	type: 'inlineEdit';
	edits: TextEdit[];
	newWholeRange: Range | undefined;
	store?: ISessionTurnStorage;
	content?: string;
	followUp?: GenerateFollowups;
}

export interface IWorkspaceEditReply {
	type: 'workspaceEdit';
	workspaceEdit: WorkspaceEdit;
	content?: string;
	followUp?: GenerateFollowups;
}

export interface IConversationalReply {
	type: 'conversational';
	content: string;
	followUp?: GenerateFollowups;
}

export type IParsedReply = (IInlineEditReply | IWorkspaceEditReply | IConversationalReply);

/**
 * Some data that can be saved in the session across turns.
 */
export interface ISessionTurnStorage {
	lastDocumentContent: string;
	lastWholeRange: Range;
}

export type GenerateFollowups = (token: CancellationToken) => Promise<InteractiveEditorReplyFollowup[] | undefined>;
