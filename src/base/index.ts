/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Progress, CancellationToken } from "vscode";
import { ChatDocumentContext, ChatResponsePart } from "./vscodeTypes";
import { ChatMessage } from "./openai";
import { PromptReference } from "./results";
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor } from "./types";
import { MetadataMap, PromptRenderer } from "./promptRenderer";
import { ITokenizer } from "./tokenizer/tokenizer";

export * from './types';
export * from './tsx-globals';
export * from './results';
export { ChatMessage } from './openai';
export { ITokenizer, Cl100KBaseTokenizerImpl } from "./tokenizer/tokenizer";

export { TextChunk, UserMessage, AssistantMessage, SystemMessage } from './promptElements';

export { PromptRenderer, RenderPromptResult, QueueItem, MetadataMap } from './promptRenderer';
export { PromptElement } from './promptElement';

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
