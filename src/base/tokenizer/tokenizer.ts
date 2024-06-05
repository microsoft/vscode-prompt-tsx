/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { ChatMessage, ChatRole } from '../openai';
import type { LanguageModelChatMessage } from '../vscodeTypes';

/**
 * Represents a tokenizer that can be used to tokenize text in chat messages.
 */
export interface ITokenizer {

	readonly _serviceBrand: undefined;

	/**
	 * Return the length of `text` in number of tokens.
	 *
	 * @param {str} text - The input text
	 * @returns {number}
	 */
	tokenLength(text: string): Promise<number> | number;

	countMessageTokens(message: ChatMessage): Promise<number> | number;
}

export class AnyTokenizer implements ITokenizer {
	_serviceBrand: undefined;

	constructor(private countTokens: (text: string | LanguageModelChatMessage, token?: CancellationToken) => Thenable<number>) { }

	async tokenLength(text: string): Promise<number> {
		return this.countTokens(text);
	}

	async countMessageTokens(message: ChatMessage): Promise<number> {
		return this.countTokens({
			role: this.toChatRole(message.role),
			content: message.content,
			name: message.name
		});
	}

	private toChatRole(role: ChatRole) {
		switch (role) {
			case ChatRole.User: return 1;
			case ChatRole.Assistant: return 2;
			case ChatRole.System: return 1;
			case ChatRole.Function: return 5;
		}
	}
}
