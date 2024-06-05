/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from 'vscode';
import { ChatMessage, ChatRole } from './openai';
import { MetadataMap, PromptRenderer } from './promptRenderer';
import { PromptReference } from './results';
import { AnyTokenizer, ITokenizer } from './tokenizer/tokenizer';
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor } from './types';
import { ChatDocumentContext, ChatResponsePart, LanguageModelChat, LanguageModelChatMessage } from './vscodeTypes.d';

export { ChatMessage, ChatRole } from './openai';
export * from './results';
export { ITokenizer } from './tokenizer/tokenizer';
export * from './tsx-globals';
export * from './types';

export { AssistantMessage, FunctionMessage, PrioritizedList, PrioritizedListProps, SystemMessage, TextChunk, UserMessage } from './promptElements';

export { PromptElement } from './promptElement';
export { MetadataMap, PromptRenderer, QueueItem, RenderPromptResult } from './promptRenderer';

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
export async function renderPrompt<P extends BasePromptElementProps>(
	ctor: PromptElementCtor<P, any>,
	props: P,
	endpoint: IChatEndpointInfo,
	tokenizerMetadata: ITokenizer | LanguageModelChat,
	progress?: Progress<ChatResponsePart>,
	token?: CancellationToken,
	mode?: 'vscode',
): Promise<{ messages: LanguageModelChatMessage[]; tokenCount: number; metadatas: MetadataMap; usedContext: ChatDocumentContext[]; references: PromptReference[] }>;
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
export async function renderPrompt<P extends BasePromptElementProps>(
	ctor: PromptElementCtor<P, any>,
	props: P,
	endpoint: IChatEndpointInfo,
	tokenizerMetadata: ITokenizer,
	progress?: Progress<ChatResponsePart>,
	token?: CancellationToken,
	mode?: 'none',
): Promise<{ messages: ChatMessage[]; tokenCount: number; metadatas: MetadataMap; usedContext: ChatDocumentContext[]; references: PromptReference[] }>;
export async function renderPrompt<P extends BasePromptElementProps>(
	ctor: PromptElementCtor<P, any>,
	props: P,
	endpoint: IChatEndpointInfo,
	tokenizerMetadata: ITokenizer | LanguageModelChat,
	progress?: Progress<ChatResponsePart>,
	token?: CancellationToken,
	mode: 'vscode' | 'none' = 'vscode',
): Promise<{ messages: (ChatMessage | LanguageModelChatMessage)[]; tokenCount: number; metadatas: MetadataMap; usedContext: ChatDocumentContext[]; references: PromptReference[] }> {
	let tokenizer = 'countTokens' in tokenizerMetadata
		? new AnyTokenizer(tokenizerMetadata.countTokens)
		: tokenizerMetadata;
	const renderer = new PromptRenderer(endpoint, ctor, props, tokenizer);
	let { messages, tokenCount, references } = await renderer.render(progress, token);
	const metadatas = renderer.getAllMeta();
	const usedContext = renderer.getUsedContext();

	if (mode === 'vscode') {
		messages = toVsCodeChatMessages(messages);
	}

	return { messages, tokenCount, metadatas, usedContext, references };
}

/**
 * Converts an array of {@link ChatMessage} objects to an array of corresponding {@link LanguageModelChatMessage VS Code chat messages}.
 * @param messages - The array of {@link ChatMessage} objects to convert.
 * @returns An array of {@link LanguageModelChatMessage VS Code chat messages}.
 */
export function toVsCodeChatMessages(messages: ChatMessage[]) {
	const vscode = require('vscode');
	return messages.map((m) => {
		switch (m.role) {
			case ChatRole.Assistant:
				return vscode.LanguageModelChatMessage.Assistant(m.content, m.name);
			case ChatRole.User:
				return vscode.LanguageModelChatMessage.User(m.content, m.name);
			default:
				throw new Error(`Converting chat message with role ${m.role} to VS Code chat message is not supported.`);
		}
	});
}
