/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	LineBreakBefore,
	MaterializedChatMessage,
	MaterializedChatMessageTextChunk,
	GenericMaterializedContainer,
} from '../materialized';
import { OutputMode, Raw } from '../output/mode';
import { ITokenizer } from '../tokenizer/tokenizer';
import { strFrom } from './testUtils';

class MockTokenizer implements ITokenizer<OutputMode.Raw> {
	readonly mode = OutputMode.Raw;
	tokenLength(part: Raw.ChatCompletionContentPart): number {
		return strFrom(part).length;
	}
	countMessageTokens(message: Raw.ChatMessage): number {
		return strFrom(message).length + 3;
	}
}
suite('Materialized', () => {
	test('should calculate token count correctly', async () => {
		const tokenizer = new MockTokenizer();
		const container = new GenericMaterializedContainer(
			undefined,
			1,
			undefined,
			1,
			parent => [
				new MaterializedChatMessage(
					parent,
					0,
					Raw.ChatRole.User,
					'user',
					undefined,
					undefined,
					1,
					[],
					parent => [
						new MaterializedChatMessageTextChunk(parent, 'Hello', 1, [], LineBreakBefore.None),
						new MaterializedChatMessageTextChunk(parent, 'World', 1, [], LineBreakBefore.None),
					]
				),
			],
			[],
			0
		);

		assert.deepStrictEqual(await container.tokenCount(tokenizer), 13);
		container.removeLowestPriorityChild();
		assert.deepStrictEqual(await container.tokenCount(tokenizer), 8);
	});

	test('should calculate lower bound token count correctly', async () => {
		const tokenizer = new MockTokenizer();
		const container = new GenericMaterializedContainer(
			undefined,
			1,
			undefined,
			1,
			parent => [
				new MaterializedChatMessage(
					parent,
					0,
					Raw.ChatRole.User,
					'user',
					undefined,
					undefined,
					1,
					[],
					parent => [
						new MaterializedChatMessageTextChunk(parent, 'Hello', 1, [], LineBreakBefore.None),
						new MaterializedChatMessageTextChunk(parent, 'World', 1, [], LineBreakBefore.None),
					]
				),
			],
			[],
			0
		);

		assert.deepStrictEqual(await container.upperBoundTokenCount(tokenizer), 13);
		container.removeLowestPriorityChild();
		assert.deepStrictEqual(await container.upperBoundTokenCount(tokenizer), 8);
	});
});
