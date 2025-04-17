/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	createTokenizer,
	getRegexByEncoder,
	getSpecialTokensByEncoder,
	TikTokenizer,
} from '@microsoft/tiktokenizer';
import { join } from 'path';
import { ITokenizer } from './tokenizer';
import { OutputMode, Raw, OpenAI } from '../output/mode';

/**
 * The Cl100K BPE tokenizer for the `gpt-4`, `gpt-3.5-turbo`, and `text-embedding-ada-002` models.
 *
 * See https://github.com/microsoft/Tokenizer
 */
export class Cl100KBaseTokenizer implements ITokenizer<OutputMode.OpenAI> {
	private _cl100kTokenizer: TikTokenizer | undefined;

	public readonly mode = OutputMode.OpenAI;
	public readonly models = ['gpt-4', 'gpt-3.5-turbo', 'text-embedding-ada-002'];

	private readonly baseTokensPerMessage = OpenAI.BaseTokensPerMessage;
	private readonly baseTokensPerName = OpenAI.BaseTokensPerName;

	constructor() {}

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
	tokenLength(part: Raw.ChatCompletionContentPart): number {
		if (part.type === Raw.ChatCompletionContentPartKind.Text) {
			return part.text ? this.tokenize(part.text).length : 0;
		}

		return 0;
	}

	/**
	 * Counts tokens for a single chat message within a completion request.
	 *
	 * Follows https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb for GPT 3.5/4 models.
	 *
	 * **Note**: The result does not include base tokens for the completion itself.
	 */
	countMessageTokens(message: OpenAI.ChatMessage): number {
		return this.baseTokensPerMessage + this.countObjectTokens(message);
	}

	private countObjectTokens(obj: any): number {
		let numTokens = 0;
		for (const [key, value] of Object.entries(obj)) {
			if (!value) {
				continue;
			}

			if (typeof value === 'string') {
				numTokens += this.tokenize(value).length;
			} else if (value) {
				// TODO@roblourens - count tokens for tool_calls correctly
				// TODO@roblourens - tool_call_id is always 1 token
				numTokens += this.countObjectTokens(value);
			}

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
