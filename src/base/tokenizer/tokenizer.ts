/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { TikTokenizer, createTokenizer, getRegexByEncoder, getSpecialTokensByEncoder } from '@microsoft/tiktokenizer';
import { join } from 'path';
import type { CancellationToken } from 'vscode';
import { BaseTokensPerMessage, BaseTokensPerName, ChatMessage, ChatRole } from '../openai';
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

/**
 * The Cl100K BPE tokenizer for the `gpt-4`, `gpt-3.5-turbo`, and `text-embedding-ada-002` models.
 *
 * See https://github.com/microsoft/Tokenizer
 */
export class Cl100KBaseTokenizer implements ITokenizer {
	declare readonly _serviceBrand: undefined;
	private _cl100kTokenizer: TikTokenizer | undefined;

	public readonly models = ['gpt-4', 'gpt-3.5-turbo', 'text-embedding-ada-002'];

	private readonly baseTokensPerMessage = BaseTokensPerMessage;
	private readonly baseTokensPerName = BaseTokensPerName;

	constructor() { }

	/**
	 * Tokenizes the given text using the Cl100K tokenizer.
	 * @param text The text to tokenize.
	 * @returns The tokenized text.
	 */
	private tokenize(text: string): number[] {
		if (!this._cl100kTokenizer) {
			this._cl100kTokenizer = this.initTokenizer();
		}
		return this._cl100kTokenizer.encode(text);
	}

	/**
	 * Calculates the token length of the given text.
	 * @param text The text to calculate the token length for.
	 * @returns The number of tokens in the text.
	 */
	tokenLength(text: string): number {
		if (!text) {
			return 0;
		}
		return this.tokenize(text).length;
	}

	/**
	 * Counts tokens for a single chat message within a completion request.
	 *
	 * Follows https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb for GPT 3.5/4 models.
	 *
	 * **Note**: The result does not include base tokens for the completion itself.
	 */
	countMessageTokens(message: ChatMessage): number {
		let numTokens = this.baseTokensPerMessage;
		for (const [key, value] of Object.entries(message)) {
			if (!value) {
				continue;
			}
			numTokens += this.tokenLength(value);
			if (key === 'name') {
				numTokens += this.baseTokensPerName;
			}
		}

		return numTokens;
	}

	private initTokenizer(): TikTokenizer {
		return createTokenizer(
			// This file is copied to `dist` via the `build/postinstall.ts` script
			join(__dirname, './cl100k_base.tiktoken'),
			getSpecialTokensByEncoder('cl100k_base'),
			getRegexByEncoder('cl100k_base'),
			64000
		);
	}
}
