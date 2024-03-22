/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from "vscode";
import { ChatMessage } from "./openai";
import { MetadataMap, PromptRenderer } from "./promptRenderer";
import { PromptReference } from "./results";
import { ITokenizer } from "./tokenizer/tokenizer";
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor } from "./types";
import { ChatDocumentContext, ChatResponsePart } from "./vscodeTypes";

export { ChatMessage } from './openai';
export * from './results';
export { Cl100KBaseTokenizerImpl, ITokenizer } from "./tokenizer/tokenizer";
export * from './tsx-globals';
export * from './types';

export { AssistantMessage, PrioritizedList, PrioritizedListProps, SystemMessage, TextChunk, UserMessage } from './promptElements';

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
 * @returns A promise that resolves to an object containing the rendered {@link ChatMessage chat messages}, token count, metadatas, used context, and references.
 */
export async function renderPrompt<P extends BasePromptElementProps>(
	ctor: PromptElementCtor<P, any>,
	props: P,
	endpoint: IChatEndpointInfo,
	progress?: Progress<ChatResponsePart>,
	token?: CancellationToken,
	tokenizer?: ITokenizer,
): Promise<{ messages: ChatMessage[]; tokenCount: number; metadatas: MetadataMap; usedContext: ChatDocumentContext[]; references: PromptReference[] }> {
	const renderer = new PromptRenderer(endpoint, ctor, props, tokenizer);
	const { messages, tokenCount } = await renderer.render(progress, token);
	const metadatas = renderer.getAllMeta();
	const usedContext = renderer.getUsedContext();
	const references = renderer.getReferences();
	return { messages, tokenCount, metadatas, usedContext, references };
}
