/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelChatMessage } from 'vscode';
import { toOpenAiChatMessage, toOpenAIChatMessages } from './openaiConvert';
import { ChatMessage as OpenAIChatMessage } from './openaiTypes';
import { ChatMessage as RawChatMessage } from './rawTypes';
import { toVsCodeChatMessage, toVsCodeChatMessages } from './vscode';

export * as OpenAI from './openaiTypes';
export * as Raw from './rawTypes';

export enum OutputMode {
	Raw = 'raw',
	OpenAI = 'openai',
	VSCode = 'vscode',
	/** @deprecated, use {@link OpenAI} */
	OpenAIOld = 'none',
}

/** Map of the mode to the type of message it produces. */
export interface ModeToChatMessageType {
	[OutputMode.Raw]: RawChatMessage;
	[OutputMode.VSCode]: LanguageModelChatMessage;
	[OutputMode.OpenAI]: OpenAIChatMessage;
	[OutputMode.OpenAIOld]: OpenAIChatMessage;
}

/**
 * Converts the raw message representation emitted by this library to the given
 * type of chat message. The target chat message may or may not represent all
 * data included in the {@link RawChatMessage}.
 */
export function toMode<Mode extends keyof ModeToChatMessageType>(
	mode: Mode,
	messages: RawChatMessage
): ModeToChatMessageType[Mode];
export function toMode<Mode extends keyof ModeToChatMessageType>(
	mode: Mode,
	messages: readonly RawChatMessage[]
): ModeToChatMessageType[Mode][];
export function toMode<Mode extends keyof ModeToChatMessageType>(
	mode: Mode,
	messages: readonly RawChatMessage[] | RawChatMessage
): ModeToChatMessageType[Mode][] | ModeToChatMessageType[Mode] {
	switch (mode) {
		case OutputMode.Raw:
			return messages as ModeToChatMessageType[Mode][];
		case OutputMode.VSCode:
			return (
				messages instanceof Array ? toVsCodeChatMessages(messages) : toVsCodeChatMessage(messages)
			) as ModeToChatMessageType[Mode];
		case OutputMode.OpenAI:
		case OutputMode.OpenAIOld:
			return (
				messages instanceof Array ? toOpenAIChatMessages(messages) : toOpenAiChatMessage(messages)
			) as ModeToChatMessageType[Mode];
		default:
			throw new Error(`Unknown output mode: ${mode}`);
	}
}

export function toVSCode(messages: RawChatMessage): LanguageModelChatMessage;
export function toVSCode(messages: readonly RawChatMessage[]): LanguageModelChatMessage[];
export function toVSCode(
	messages: readonly RawChatMessage[] | RawChatMessage
): LanguageModelChatMessage | LanguageModelChatMessage[] {
	return toMode(OutputMode.VSCode, messages as any);
}

export function toOpenAI(messages: RawChatMessage): OpenAIChatMessage;
export function toOpenAI(messages: readonly RawChatMessage[]): OpenAIChatMessage[];
export function toOpenAI(
	messages: readonly RawChatMessage[] | RawChatMessage
): OpenAIChatMessage | OpenAIChatMessage[] {
	return toMode(OutputMode.OpenAI, messages as any);
}
