/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	CancellationToken,
	ChatResponsePart,
	LanguageModelChat,
	LanguageModelChatMessage,
	Progress,
} from 'vscode';
import { PromptElementJSON } from './jsonTypes';
import { ModeToChatMessageType, OutputMode, Raw } from './output/mode';
import { ChatMessage } from './output/openaiTypes';
import { MetadataMap, PromptRenderer } from './promptRenderer';
import { PromptReference } from './results';
import { ITokenizer, VSCodeTokenizer } from './tokenizer/tokenizer';
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor } from './types';
import { ChatDocumentContext } from './vscodeTypes.d';

export * from './htmlTracer';
export * as JSONTree from './jsonTypes';
export * from './output/mode';
export * from './promptElements';
export * from './results';
export { ITokenizer } from './tokenizer/tokenizer';
export * from './tracer';
export * from './tsx-globals';
export * from './types';

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
	tokenizerMetadata: ITokenizer<OutputMode.VSCode> | LanguageModelChat,
	progress?: Progress<ChatResponsePart>,
	token?: CancellationToken,
	mode?: OutputMode.VSCode
): Promise<{
	messages: LanguageModelChatMessage[];
	tokenCount: number;
	metadata: MetadataMap;
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
export async function renderPrompt<P extends BasePromptElementProps, TMode extends OutputMode>(
	ctor: PromptElementCtor<P, any>,
	props: P,
	endpoint: IChatEndpointInfo,
	tokenizerMetadata: ITokenizer<TMode>,
	progress?: Progress<ChatResponsePart>,
	token?: CancellationToken
): Promise<{
	messages: ModeToChatMessageType[TMode][];
	tokenCount: number;
	metadata: MetadataMap;
	usedContext: ChatDocumentContext[];
	references: PromptReference[];
}>;
export async function renderPrompt<P extends BasePromptElementProps>(
	ctor: PromptElementCtor<P, any>,
	props: P,
	endpoint: IChatEndpointInfo,
	tokenizerMetadata: ITokenizer<OutputMode.VSCode> | LanguageModelChat,
	progress?: Progress<ChatResponsePart>,
	token?: CancellationToken,
	mode = OutputMode.VSCode
): Promise<{
	messages: (ChatMessage | LanguageModelChatMessage)[];
	tokenCount: number;
	metadata: MetadataMap;
	usedContext: ChatDocumentContext[];
	references: PromptReference[];
}> {
	let tokenizer =
		'countTokens' in tokenizerMetadata
			? new VSCodeTokenizer((text, token) => tokenizerMetadata.countTokens(text, token), mode)
			: tokenizerMetadata;
	const renderer = new PromptRenderer(endpoint, ctor, props, tokenizer);
	const renderResult = await renderer.render(progress, token);
	const usedContext = renderer.getUsedContext();
	return { ...renderResult, usedContext };
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
	budgetInformation:
		| {
				tokenBudget: number;
				countTokens(text: string, token?: CancellationToken): Thenable<number>;
		  }
		| undefined,
	token?: CancellationToken
): Promise<PromptElementJSON> {
	const renderer = new PromptRenderer(
		{ modelMaxPromptTokens: budgetInformation?.tokenBudget ?? Number.MAX_SAFE_INTEGER },
		ctor,
		props,
		// note: if tokenBudget is given, countTokens is also give and vise-versa.
		// `1` is used only as a dummy fallback to avoid errors if no/unlimited budget is provided.
		{
			mode: OutputMode.Raw,
			countMessageTokens(message) {
				throw new Error('Tools may only return text, not messages.'); // for now...
			},
			tokenLength(part, token) {
				if (part.type === Raw.ChatCompletionContentPartKind.Text) {
					return Promise.resolve(
						budgetInformation?.countTokens(part.text, token) ?? Promise.resolve(1)
					);
				}
				return Promise.resolve(1);
			},
		}
	);

	return renderer.renderElementJSON(token);
}
