/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ChatMessage, ChatRole } from '../openai';
import { PromptElement } from '../promptElement';
import { TextChunk, UserMessage } from '../promptElements';
import { PromptRenderer } from '../promptRenderer';
import { ITokenizer } from '../tokenizer/tokenizer';
import {
	IChatEndpointInfo
} from '../types';

suite('PromptElements', () => {
	suite('TextChunk', () => {
		const tokenizer = new class TokenPerWordTokenizer implements ITokenizer {
			_serviceBrand: undefined;
			baseTokensPerMessage = 0;
			baseTokensPerName = 0;
			baseTokensPerCompletion = 0;

			tokenLength(text: string): number {
				return text.trim() === '' ? 1 : text.split(/\s+/g).length;
			}

			countMessageTokens(message: ChatMessage): number {
				return this.tokenLength(message.content);
			}
		}

		const assertThrows = async (message: RegExp, fn: () => Promise<void>) => {
			let thrown = false;
			try {
				await fn();
			} catch (e) {
				thrown = true;
				assert.ok(message.test((e as Error).message));
			}
			assert.ok(thrown, 'expected to throw');
		}

		test('split behavior', async () => {
			const inst = new PromptRenderer(
				{ modelMaxPromptTokens: 11 } satisfies Partial<IChatEndpointInfo> as IChatEndpointInfo,
				class extends PromptElement {
					render() {
						return <UserMessage>
							<TextChunk breakOnWhitespace>1a<br />1b 1c 1d 1e 1f 1g 1h 1i 1j 1k 1l 1m 1n 1o 1p 1q 1r 1s 1t 1u 1v 1w 1x 1y 1z</TextChunk>
							<TextChunk breakOn=" ">2a 2b 2c 2d 2e 2f 2g 2h 2i 2j 2k 2l 2m 2n 2o 2p 2q 2r 2s 2t 2u 2v 2w 2x 2y 2z</TextChunk>
						</UserMessage>;
					}
				},
				{},
				tokenizer
			);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					content: '1a\n1b 1c 1d 1e\n2a 2b 2c 2d 2e',
					role: ChatRole.User,
				},
			]);
		});

		test('throws on extrinsic', async () => {
			await assertThrows(/must be text literals/, async () => {
				const inst = new PromptRenderer(
					{ modelMaxPromptTokens: 11 } satisfies Partial<IChatEndpointInfo> as IChatEndpointInfo,
					class Foo extends PromptElement {
						render() {
							return <UserMessage><TextChunk breakOnWhitespace><Foo /></TextChunk></UserMessage>;
						}
					},
					{},
					tokenizer
				);
				await inst.render(undefined, undefined);
			});
		});
	});
});
