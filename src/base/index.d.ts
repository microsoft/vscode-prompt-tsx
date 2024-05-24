/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from "vscode";
import { ChatMessage } from "./openai";
import { MetadataMap } from "./promptRenderer";
import { PromptReference } from "./results";
import { ITokenizer } from "./tokenizer/tokenizer";
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor } from "./types";
import { ChatDocumentContext, ChatResponsePart, LanguageModelChatMessage } from "./vscodeTypes";
export { ChatMessage, ChatRole } from './openai';
export { PromptElement } from './promptElement';
export { AssistantMessage, PrioritizedList, PrioritizedListProps, SystemMessage, TextChunk, UserMessage } from './promptElements';
export { MetadataMap, PromptRenderer, QueueItem, RenderPromptResult } from './promptRenderer';
export * from './results';
export { Cl100KBaseTokenizer, ITokenizer } from "./tokenizer/tokenizer";
export * from './tsx-globals';
export * from './types';

/**
 * Renders a prompt element and returns the result.
 *
 * @template P - The type of the prompt element props.
 * @param ctor - The constructor of the prompt element.
 * @param props - The props for the prompt element.
 * @param endpoint - The chat endpoint information.
 * @param progress - The progress object for reporting progress of the chat response.
 * @param token - The cancellation token for cancelling the operation.
 * @param tokenizer - The tokenizer for tokenizing the chat response.
 * @param mode - The mode to render the chat messages in.
 * @returns A promise that resolves to an object containing the rendered {@link LanguageModelChatMessage chat messages}, token count, metadatas, used context, and references.
 */
export declare function renderPrompt<P extends BasePromptElementProps>(ctor: PromptElementCtor<P, any>, props: P, endpoint: IChatEndpointInfo, tokenizer: ITokenizer, progress?: Progress<ChatResponsePart>, token?: CancellationToken, mode?: 'vscode'): Promise<{
	messages: LanguageModelChatMessage[];
	tokenCount: number;
	metadatas: MetadataMap;
	usedContext: ChatDocumentContext[];
	references: PromptReference[];
}>;

/**
 * Renders a prompt element and returns the result.
 *
 * @template P - The type of the prompt element props.
 * @param ctor - The constructor of the prompt element.
 * @param props - The props for the prompt element.
 * @param endpoint - The chat endpoint information.
 * @param progress - The progress object for reporting progress of the chat response.
 * @param token - The cancellation token for cancelling the operation.
 * @param tokenizer - The tokenizer for tokenizing the chat response.
 * @param mode - The mode to render the chat messages in.
 * @returns A promise that resolves to an object containing the rendered {@link ChatMessage chat messages}, token count, metadatas, used context, and references.
 */
export declare function renderPrompt<P extends BasePromptElementProps>(ctor: PromptElementCtor<P, any>, props: P, endpoint: IChatEndpointInfo, tokenizer: ITokenizer, progress?: Progress<ChatResponsePart>, token?: CancellationToken, mode?: 'none'): Promise<{
	messages: ChatMessage[];
	tokenCount: number;
	metadatas: MetadataMap;
	usedContext: ChatDocumentContext[];
	references: PromptReference[];
}>;

/**
 * Converts an array of {@link ChatMessage} objects to an array of corresponding {@link LanguageModelChatMessage VS Code chat messages}.
 * @param messages - The array of {@link ChatMessage} objects to convert.
 * @returns An array of {@link LanguageModelChatMessage VS Code chat messages}.
 */
export declare function toVsCodeChatMessages(messages: ChatMessage[]): any[];
