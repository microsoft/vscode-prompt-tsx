/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * An OpenAI Chat Completion message.
 *
 * Reference: https://platform.openai.com/docs/api-reference/chat/create
 */
export declare interface ChatMessage {
	/**
	 * The role of the chat message (e.g., 'system', 'user', 'assistant').
	 */
	role: ChatRole;
	/**
	 * The content of the chat message.
	 */
	content: string;
	/**
	 * An optional name for the participant. Provides the model information to differentiate between participants of the same role.
	 */
	name?: string;
}

/**
 * The role of a message in an OpenAI completions request.
 */
export enum ChatRole {
	System = 'system',
	User = 'user',
	Assistant = 'assistant'
}

/**
 * BaseTokensPerCompletion is the minimum tokens for a completion request.
 * Replies are primed with <|im_start|>assistant<|message|>, so these tokens represent the
 * special token and the role name.
 */
export const BaseTokensPerCompletion = 3;
/*
 * Each GPT 3.5 / GPT 4 message comes with 3 tokens per message due to special characters
 */
export const BaseTokensPerMessage = 3;
/*
 * Since gpt-3.5-turbo-0613 each name costs 1 token
 */
export const BaseTokensPerName = 1;
