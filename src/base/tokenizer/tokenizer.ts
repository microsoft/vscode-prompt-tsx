/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, LanguageModelChatMessage } from 'vscode';
import { ChatMessage, ChatRole } from '../openai';

/**
 * Represents a tokenizer that can be used to tokenize text in chat messages.
 */
export interface ITokenizer {
	/**
	 * Return the length of `text` in number of tokens.
	 *
	 * @param {str} text - The input text
	 * @returns {number}
	 */
	tokenLength(text: string, token?: CancellationToken): Promise<number> | number;

	countMessageTokens(message: ChatMessage): Promise<number> | number;
}

export class AnyTokenizer implements ITokenizer {
	constructor(
		private countTokens: (
			text: string | LanguageModelChatMessage,
			token?: CancellationToken
		) => Thenable<number>,
		mode: 'vscode' | 'none',
	) {
		if (mode !== 'vscode') {
			throw new Error('`mode` must be set to vscode when using vscode.LanguageModelChat as the tokenizer');
		}
	}

	async tokenLength(text: string, token?: CancellationToken): Promise<number> {
		return this.countTokens(text, token);
	}

	async countMessageTokens(message: ChatMessage): Promise<number> {
		const vscode = await import('vscode');
		return this.countTokens({
			role: this.toChatRole(message.role),
			content: [new vscode.LanguageModelTextPart(this.extractText(message))],
			name: 'name' in message ? message.name : undefined,
		});
	}

	extractText(message: ChatMessage): string {
		if (message.content instanceof Array) {
			return message.content.map(c => 'text' in c ? c.text : '').join('');
		}
		return message.content;
	}

	private toChatRole(role: ChatRole) {
		switch (role) {
			case ChatRole.User:
				return 1;
			case ChatRole.Assistant:
				return 2;
			case ChatRole.System:
				return 1;
			case ChatRole.Function:
				return 1;
			case ChatRole.Tool:
				return 1;
		}
	}
}
