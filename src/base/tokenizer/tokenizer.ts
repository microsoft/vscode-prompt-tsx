/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, LanguageModelChatMessage } from 'vscode';
import { ModeToChatMessageType, OutputMode, Raw } from '../output/mode';

/**
 * Represents a tokenizer that can be used to tokenize text in chat messages.
 */
export interface ITokenizer<M extends OutputMode = OutputMode> {
	/**
	 * This mode this tokenizer operates on.
	 */
	readonly mode: M;

	/**
	 * Return the length of `part` in number of tokens. If the model does not
	 * support the given kind of part, it may return 0.
	 *
	 * @param {str} text - The input text
	 * @returns {number}
	 */
	tokenLength(
		part: Raw.ChatCompletionContentPart,
		token?: CancellationToken
	): Promise<number> | number;

	/**
	 * Returns the token length of the given message.
	 */
	countMessageTokens(message: ModeToChatMessageType[M]): Promise<number> | number;
}

export class VSCodeTokenizer implements ITokenizer<OutputMode.VSCode> {
	public readonly mode = OutputMode.VSCode;

	constructor(
		private countTokens: (
			text: string | LanguageModelChatMessage,
			token?: CancellationToken
		) => Thenable<number>,
		mode: OutputMode
	) {
		if (mode !== OutputMode.VSCode) {
			throw new Error(
				'`mode` must be set to vscode when using vscode.LanguageModelChat as the tokenizer'
			);
		}
	}

	async tokenLength(
		part: Raw.ChatCompletionContentPart,
		token?: CancellationToken
	): Promise<number> {
		if (part.type === Raw.ChatCompletionContentPartKind.Text) {
			return this.countTokens(part.text, token);
		}

		return Promise.resolve(0);
	}

	async countMessageTokens(message: LanguageModelChatMessage): Promise<number> {
		return this.countTokens(message);
	}
}
