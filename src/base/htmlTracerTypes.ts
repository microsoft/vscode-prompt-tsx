/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ITraceEpoch } from './tracer';

export type HTMLTraceEpoch = ITraceEpoch;

export interface IHTMLTraceRenderData {
	container: ITraceMaterializedContainer;
	removed: number;
	budget: number;
}

export type ITraceMaterializedNode =
	| ITraceMaterializedContainer
	| ITraceMaterializedChatMessage
	| ITraceMaterializedChatMessageTextChunk
	| ITraceMaterializedChatMessageImage;

export const enum TraceMaterializedNodeType {
	Container,
	ChatMessage,
	TextChunk,
	Image,
}

export interface IMaterializedMetadata {
	name: string;
	value: string;
}

export interface ITraceMaterializedCommon {
	priority: number;
	tokens: number;
	metadata: IMaterializedMetadata[];
}

export interface ITraceMaterializedContainer extends ITraceMaterializedCommon {
	type: TraceMaterializedNodeType.Container;
	id: number;
	name: string | undefined;
	children: ITraceMaterializedNode[];
}

export interface ITraceMaterializedChatMessage extends ITraceMaterializedCommon {
	type: TraceMaterializedNodeType.ChatMessage;
	id: number;
	role: string;
	name: string | undefined;
	priority: number;
	text: string;
	tokens: number;
	children: ITraceMaterializedNode[];
}

export interface ITraceMaterializedChatMessageTextChunk extends ITraceMaterializedCommon {
	type: TraceMaterializedNodeType.TextChunk;
	value: string;
	priority: number;
	tokens: number;
}

export interface ITraceMaterializedChatMessageImage extends ITraceMaterializedCommon {
	id: number;
	type: TraceMaterializedNodeType.Image;
	name: string
	value: string;
	priority: number;
	tokens: number;
	children: ITraceMaterializedNode[];
}

