/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MaterializedChatMessage, MaterializedChatMessageTextChunk, MaterializedContainer } from '../materialized';
import { ChatRole } from '../openai';
import { ITokenizer } from '../tokenizer/tokenizer';
class MockTokenizer implements ITokenizer {
	tokenLength(text: string): number {
		return text.length;
	}
	countMessageTokens(message: any): number {
		return message.content.length + 3;
	}
}
suite('Materialized', () => {
	test('should calculate token count correctly', async () => {
		const tokenizer = new MockTokenizer();
		const child1 = new MaterializedChatMessageTextChunk('Hello', 1, [], false);
		const child2 = new MaterializedChatMessageTextChunk('World', 1, [], false);
		const message = new MaterializedChatMessage(ChatRole.User, 'user', undefined, undefined, 1, 0, [], [child1, child2]);
		const container = new MaterializedContainer(1, [message], []);

		assert.deepStrictEqual(await container.tokenCount(tokenizer), 13);
		container.removeLowestPriorityChild();
		assert.deepStrictEqual(await container.tokenCount(tokenizer), 8);
	});

	test('should calculate lower bound token count correctly', async () => {
		const tokenizer = new MockTokenizer();
		const child1 = new MaterializedChatMessageTextChunk('Hello', 1, [], false);
		const child2 = new MaterializedChatMessageTextChunk('World', 1, [], false);
		const message = new MaterializedChatMessage(ChatRole.User, 'user', undefined, undefined, 1, 0, [], [child1, child2]);
		const container = new MaterializedContainer(1, [message], []);

		assert.deepStrictEqual(await container.upperBoundTokenCount(tokenizer), 13);
		container.removeLowestPriorityChild();
		assert.deepStrictEqual(await container.upperBoundTokenCount(tokenizer), 8);
	});
});
