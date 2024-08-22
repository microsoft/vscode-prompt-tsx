/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from 'vscode';
import { PromptElementJSON } from './jsonTypes';
import { ChatMessage, ChatRole } from './openai';
import { MetadataMap, PromptRenderer } from './promptRenderer';
import { PromptReference } from './results';
import { AnyTokenizer, ITokenizer } from './tokenizer/tokenizer';
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor } from './types';
import { ChatDocumentContext, ChatResponsePart, LanguageModelChat, LanguageModelChatMessage } from './vscodeTypes.d';

export * as JSONTree from './jsonTypes';
export { ChatMessage, ChatRole } from './openai';
export * from './results';
export { ITokenizer } from './tokenizer/tokenizer';
export * from './tsx-globals';
export * from './types';

export { AssistantMessage, FunctionMessage, PrioritizedList, PrioritizedListProps, SystemMessage, TextChunk, TextChunkProps, UserMessage } from './promptElements';

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
		? new AnyTokenizer((text, token) => tokenizerMetadata.countTokens(text, token))
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
 * Content type of the return value from {@link renderElementJSON}.
 * When responding to a tool invocation, the tool should set this as the
 * content type in the returned data:
 *
 * ```ts
 * import { contentType } from '@vscode/prompt-tsx';
 *
 * async function doToolInvocation(): vscode.LanguageModelToolResult {
 *   return {
 *     [contentType]: await renderElementJSON(...),
 *     toString: () => '...',
 *   };
 * }
 * ```
 */
export const contentType = 'application/vnd.codechat.prompt+json.1';

/**
 * Renders a prompt element to a serializable state. This type be returned in
 * tools results and reused in subsequent render calls via the `<Tool />`
 * element.
 *
 * In this mode, message chunks are not pruned from the tree; budget
 * information is used only to hint to the elements how many tokens they should
 * consume when rendered.
 *
 * @template P - The type of the prompt element props.
 * @param ctor - The constructor of the prompt element.
 * @param props - The props for the prompt element.
 * @param budgetInformation - Information about the token budget.
 * `vscode.LanguageModelToolInvocationOptions` is assignable to this object.
 * @param token - The cancellation token for cancelling the operation.
 * @returns A promise that resolves to an object containing the serialized data.
 */
export function renderElementJSON<P extends BasePromptElementProps>(
	ctor: PromptElementCtor<P, any>,
	props: P,
	budgetInformation: {
		tokenBudget: number;
		countTokens(text: string, token?: CancellationToken): Thenable<number>;
	} | undefined,
	token?: CancellationToken,
): Promise<PromptElementJSON> {
	const renderer = new PromptRenderer(
		{ modelMaxPromptTokens: budgetInformation?.tokenBudget ?? Number.MAX_SAFE_INTEGER },
		ctor,
		props,
		// note: if tokenBudget is given, countTokens is also give and vise-versa.
		// `1` is used only as a dummy fallback to avoid errors if no/unlimited budget is provided.
		{
			countMessageTokens(message) {
				throw new Error('Tools may only return text, not messages.'); // for now...
			},
			tokenLength(text, token) {
				return Promise.resolve(budgetInformation?.countTokens(text, token) ?? Promise.resolve(1));
			},
		},
	);

	return renderer.renderElementJSON(token);
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
			case ChatRole.Function: {
				const message = vscode.LanguageModelChatMessage.User('');
				message.content2 = new vscode.LanguageModelChatMessageFunctionResultPart(m.name, m.content);
				return message;
			}
			default:
				throw new Error(`Converting chat message with role ${m.role} to VS Code chat message is not supported.`);
		}
	});
}
