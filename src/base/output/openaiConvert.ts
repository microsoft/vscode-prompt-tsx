/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as Raw from './rawTypes';
import * as OpenAI from './openaiTypes';
import { OutputMode } from './mode';

function onlyStringContent(content: Raw.ChatCompletionContentPart[]): string {
	return content
		.filter(part => part.type === Raw.ChatCompletionContentPartKind.Text)
		.map(part => part.text)
		.join('');
}

function stringAndImageContent(
	content: Raw.ChatCompletionContentPart[]
): string | OpenAI.ChatCompletionContentPart[] {

	const parts = content
		.map((part): OpenAI.ChatCompletionContentPart | undefined => {
			if (part.type === Raw.ChatCompletionContentPartKind.Text) {
				return {
					type: 'text',
					text: part.text,
				};
			} else if (part.type === Raw.ChatCompletionContentPartKind.Image) {
				return {
					image_url: part.imageUrl,
					type: 'image_url',
				};
			} else if (
				part.type === Raw.ChatCompletionContentPartKind.Opaque &&
				Raw.ChatCompletionContentPartOpaque.usableIn(part, OutputMode.OpenAI)
			) {
				return part.value as any;
			}
		})
		.filter(r => !!r);


	if (parts.every(part => part.type === 'text')) {
		return parts.map(p=> (p as OpenAI.ChatCompletionContentPartText).text).join('');
	}

	return parts;
}

export function toOpenAiChatMessage(message: Raw.ChatMessage): OpenAI.ChatMessage | undefined {
	switch (message.role) {
		case Raw.ChatRole.System:
			return {
				role: OpenAI.ChatRole.System,
				content: onlyStringContent(message.content),
				name: message.name,
			};
		case Raw.ChatRole.User:
			return {
				role: OpenAI.ChatRole.User,
				content: stringAndImageContent(message.content),
				name: message.name,
			};
		case Raw.ChatRole.Assistant:
			return {
				role: OpenAI.ChatRole.Assistant,
				content: onlyStringContent(message.content),
				name: message.name,
				...(message.phase ? { phase: message.phase } : undefined),
				tool_calls: message.toolCalls?.map(toolCall => ({
					id: toolCall.id,
					function: toolCall.function,
					type: 'function',
				})),
			};
		case Raw.ChatRole.Tool:
			return {
				role: OpenAI.ChatRole.Tool,
				content: stringAndImageContent(message.content),
				tool_call_id: message.toolCallId,
			};
		default:
			return undefined;
	}
}

export function toOpenAIChatMessages(messages: readonly Raw.ChatMessage[]): OpenAI.ChatMessage[] {
	return messages.map(toOpenAiChatMessage).filter(r => !!r);
}
