/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	LineBreakBefore,
	MaterializedChatMessage,
	MaterializedChatMessageImage,
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
	function messageOf(
		chunks: (
			parent: MaterializedChatMessage
		) => (MaterializedChatMessageTextChunk | MaterializedChatMessageImage)[]
	) {
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
					chunks
				),
			],
			[],
			0
		);
		return container.children[0] as MaterializedChatMessage;
	}

	test('text adds a line break only where one is missing', () => {
		const message = messageOf(parent => [
			new MaterializedChatMessageTextChunk(parent, '', 1, [], LineBreakBefore.None),
			new MaterializedChatMessageTextChunk(parent, 'a', 1, [], LineBreakBefore.Always),
			new MaterializedChatMessageTextChunk(parent, 'b', 1, [], LineBreakBefore.Always),
			new MaterializedChatMessageTextChunk(parent, 'c\n', 1, [], LineBreakBefore.None),
			new MaterializedChatMessageTextChunk(parent, 'd', 1, [], LineBreakBefore.Always),
			new MaterializedChatMessageTextChunk(parent, '', 1, [], LineBreakBefore.Always),
			new MaterializedChatMessageTextChunk(parent, 'e', 1, [], LineBreakBefore.IfNotTextSibling),
			new MaterializedChatMessageImage(parent, 0, 'img', 1, [], LineBreakBefore.None),
			new MaterializedChatMessageTextChunk(parent, 'f', 1, [], LineBreakBefore.Always),
			new MaterializedChatMessageTextChunk(parent, 'g', 1, [], LineBreakBefore.None),
		]);
		const text = message.text;
		assert.deepStrictEqual(text.length, 3);
		assert.deepStrictEqual(text[0], 'a\nbc\nd\ne');
		assert.ok(text[1] instanceof MaterializedChatMessageImage);
		assert.deepStrictEqual(text[2], 'fg');
	});

	// Regression for #205: each line-broken chunk used to call endsWith on the
	// growing concatenated string, which flattens it, so text was O(n^2) in the
	// number of chunks (seconds for a few MB of tool output, rebuilt every render).
	test('text is linear in the number of chunks', function () {
		this.timeout(120_000);
		const count = 30_000;
		const message = messageOf(parent =>
			Array.from(
				{ length: count },
				(_, i) =>
					new MaterializedChatMessageTextChunk(
						parent,
						`line ${i} ${'x'.repeat(60)}`,
						1,
						[],
						LineBreakBefore.Always
					)
			)
		);
		const start = performance.now();
		const text = message.text;
		const elapsed = performance.now() - start;
		assert.deepStrictEqual(text.length, 1);
		assert.deepStrictEqual((text[0] as string).split('\n').length, count);
		assert.ok(elapsed < 1000, `text took ${elapsed.toFixed(0)}ms for ${count} chunks`);
	});
});
