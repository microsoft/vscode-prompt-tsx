/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Range } from 'vscode';
import { ChatResponseReferencePartStatusKind } from './results';
import { UriComponents } from './util/vs/common/uri';

// Types in this region are the JSON representation of prompt elements. These
// can be transmitted between tools and tool callers.
//
// ⚠️ Changes to these types MUST be made in a backwards-compatible way. ⚠️
// Tools and tool callers may be using different prompt-tsx versions.
//
// All enums in this file have explicitly-assigned values, and authors should
// take care not to change existing enum valus.

export const enum PromptNodeType {
	Piece = 1,
	Text = 2,
}

export interface TextJSON {
	type: PromptNodeType.Text;
	text: string;
	priority: number | undefined;
	references: PromptReferenceJSON[] | undefined;
	lineBreakBefore: boolean | undefined;
}

/**
 * Constructor kind of the node represented by {@link PieceJSON}. This is
 * less descriptive than the actual constructor, as we only care to preserve
 * the element data that the renderer cares about.
 */
export const enum PieceCtorKind {
	BaseChatMessage = 1,
	Other = 2,
	ImageChatMessage = 3
}

export interface BasePieceJSON {
	type: PromptNodeType.Piece;
	ctor: PieceCtorKind.BaseChatMessage | PieceCtorKind.Other;
	priority: number | undefined;
	children: PromptNodeJSON[];
	references: PromptReferenceJSON[] | undefined;
	props?: Record<string, unknown>;
}

export interface ImageChatMessagePieceJSON {
	type: PromptNodeType.Piece;
	ctor: PieceCtorKind.ImageChatMessage;
	priority: number | undefined;
	children: PromptNodeJSON[];
	references: PromptReferenceJSON[] | undefined;
	props: {
		imageUrl: string;
		detail?: "low" | "high";
	};
}

export type PieceJSON = BasePieceJSON | ImageChatMessagePieceJSON;

export type PromptNodeJSON = PieceJSON | TextJSON;

export type UriOrLocationJSON = UriComponents | { uri: UriComponents; range: Range };

export interface PromptReferenceJSON {
	anchor: UriOrLocationJSON | { variableName: string; value?: UriOrLocationJSON };
	iconPath?: UriComponents | { id: string } | { light: UriComponents; dark: UriComponents };
	options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } };
}

export interface PromptElementJSON {
	node: PieceJSON;
}

/** Iterates over each {@link PromptNodeJSON} in the tree. */
export function forEachNode(node: PromptNodeJSON, fn: (node: PromptNodeJSON) => void) {
	fn(node);

	if (node.type === PromptNodeType.Piece) {
		for (const child of node.children) {
			forEachNode(child, fn);
		}
	}
}
