/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { once } from './once';
import { ChatMessage, ChatMessageToolCall, ChatRole } from './openai';
import { PromptMetadata } from './results';
import { ITokenizer } from './tokenizer/tokenizer';

export interface IMaterializedNode {
	/**
	 * Gets the maximum number of tokens this message can contain. This is
	 * calculated by summing the token counts of all individual messages, which
	 * may be larger than the real count due to merging of sibling tokens.
	 */
	upperBoundTokenCount(tokenizer: ITokenizer): Promise<number>;

	/**
	 * Gets the precise number of tokens this message contains.
	 */
	tokenCount(tokenizer: ITokenizer): Promise<number>;
}

export type MaterializedNode = MaterializedContainer | MaterializedChatMessage | MaterializedChatMessageTextChunk;

export class MaterializedContainer implements IMaterializedNode {

	constructor(
		public readonly priority: number,
		public readonly children: MaterializedNode[],
		public readonly metadata: PromptMetadata[],
	) { }

	/** @inheritdoc */
	async tokenCount(tokenizer: ITokenizer): Promise<number> {
		let total = 0;
		await Promise.all(this.children.map(async (child) => {
			// note: this method is not called when the container is inside a chat
			// message, because in that case the chat message generates the text
			// and counts that.
			assertContainerOrChatMessage(child);

			const amt = await child.tokenCount(tokenizer);
			total += amt;
		}));
		return total;
	}

	/** @inheritdoc */
	async upperBoundTokenCount(tokenizer: ITokenizer): Promise<number> {
		let total = 0;
		await Promise.all(this.children.map(async (child) => {
			const amt = await child.upperBoundTokenCount(tokenizer);
			total += amt;
		}));
		return total;
	}

	/**
	 * Gets all metadata the container holds.
	 */
	allMetadata(): Generator<PromptMetadata> {
		return allMetadata(this);
	}

	/**
	 * Gets the chat messages the container holds.
	 */
	toChatMessages(): ChatMessage[] {
		return this.children.flatMap(child => {
			assertContainerOrChatMessage(child);
			return child instanceof MaterializedContainer ? child.toChatMessages() : [child.toChatMessage()];
		})
	}

	/** Removes the node in the tree with the lowest priority. */
	removeLowestPriorityChild(): void {
		removeLowestPriorityChild(this.children);
	}
}

/** A chunk of text in a {@link MaterializedChatMessage} */
export class MaterializedChatMessageTextChunk {
	constructor(
		public readonly text: string,
		public readonly priority: number,
		public readonly metadata: PromptMetadata[] = [],
		public readonly lineBreakBefore: boolean,
	) { }

	public upperBoundTokenCount(tokenizer: ITokenizer) {
		return this._upperBound(tokenizer);
	}

	private readonly _upperBound = once((tokenizer: ITokenizer) => {
		return tokenizer.tokenLength(this.text);
	});
}

export class MaterializedChatMessage implements IMaterializedNode {

	constructor(
		public readonly role: ChatRole,
		public readonly name: string | undefined,
		public readonly toolCalls: ChatMessageToolCall[] | undefined,
		public readonly toolCallId: string | undefined,
		public readonly priority: number,
		private readonly childIndex: number,
		public readonly metadata: PromptMetadata[],
		public readonly children: MaterializedNode[],
	) { }

	/** @inheritdoc */
	public async tokenCount(tokenizer: ITokenizer): Promise<number> {
		return this._tokenCount(tokenizer);
	}

	/** @inheritdoc */
	public async upperBoundTokenCount(tokenizer: ITokenizer): Promise<number> {
		return this._upperBound(tokenizer);
	}

	/** Gets the text this message contains */
	public get text(): string {
		return this._text()
	}

	/** Remove the lowest priority chunk among this message's children. */
	removeLowestPriorityChild() {
		removeLowestPriorityChild(this.children);
		this.onChunksChange();
	}

	private onChunksChange() {
		this._tokenCount.clear();
		this._upperBound.clear();
		this._text.clear();
	}

	private readonly _tokenCount = once(async (tokenizer: ITokenizer) => {
		return tokenizer.countMessageTokens(this.toChatMessage());
	});

	private readonly _upperBound = once(async (tokenizer: ITokenizer) => {
		let total = await this._baseMessageTokenCount(tokenizer)
		await Promise.all(this.children.map(async (chunk) => {
			const amt = await chunk.upperBoundTokenCount(tokenizer);
			total += amt + (chunk instanceof MaterializedChatMessageTextChunk && chunk.lineBreakBefore ? 1 : 0);
		}));
		return total;
	});

	private readonly _baseMessageTokenCount = once((tokenizer: ITokenizer) => {
		return tokenizer.countMessageTokens({ ...this.toChatMessage(), content: '' });
	});

	private readonly _text = once(() => {
		let result = '';
		for (const chunk of textChunks(this)) {
			if (chunk.lineBreakBefore && result.length && !result.endsWith('\n')) {
				result += '\n';
			}
			result += chunk.text;
		}

		return result;
	});

	public toChatMessage(): ChatMessage {
		if (this.role === ChatRole.System) {
			return {
				role: this.role,
				content: this.text,
				...(this.name ? { name: this.name } : {})
			};
		} else if (this.role === ChatRole.Assistant) {
			return {
				role: this.role,
				content: this.text,
				...(this.toolCalls ? { tool_calls: this.toolCalls } : {}),
				...(this.name ? { name: this.name } : {})
			};
		} else if (this.role === ChatRole.User) {
			return {
				role: this.role,
				content: this.text,
				...(this.name ? { name: this.name } : {})
			}
		} else if (this.role === ChatRole.Tool) {
			return {
				role: this.role,
				content: this.text,
				tool_call_id: this.toolCallId
			};
		} else {
			return {
				role: this.role,
				content: this.text,
				name: this.name!
			};
		}
	}

	public static cmp(a: MaterializedChatMessage, b: MaterializedChatMessage): number {
		if (a.priority !== b.priority) {
			return (b.priority || 0) - (a.priority || 0);
		}
		return b.childIndex - a.childIndex;
	}
}

function assertContainerOrChatMessage(v: MaterializedNode): asserts v is MaterializedContainer | MaterializedChatMessage {
	if (!(v instanceof MaterializedContainer) && !(v instanceof MaterializedChatMessage)) {
		throw new Error(`Cannot have a text node outside a ChatMessage. Text: "${v.text}"`);
	}
}


function* textChunks(node: MaterializedNode): Generator<MaterializedChatMessageTextChunk> {
	if (node instanceof MaterializedChatMessageTextChunk) {
		yield node;
		return;
	}

	for (const child of node.children) {
		if (child instanceof MaterializedChatMessageTextChunk) {
			yield child;
		} else {
			yield* textChunks(child);
		}
	}
}

function removeLowestPriorityChild(children: MaterializedNode[]) {
	if (!children.length) {
		return;
	}

	let lowestIndex = 0;
	let lowestNestedChildPriority: number | undefined;
	for (let i = 1; i < children.length; i++) {
		if (children[i].priority < children[lowestIndex].priority) {
			lowestIndex = i;
			lowestNestedChildPriority = undefined;
		} else if (children[i].priority === children[lowestIndex].priority) {
			// Use the lowest priority of any of their nested remaining children as a tiebreaker,
			// useful e.g. when dealing with root sibling user vs. system messages
			lowestNestedChildPriority ??= getLowestPriorityAmongChildren(children[lowestIndex]);
			const lowestNestedPriority = getLowestPriorityAmongChildren(children[i]);
			if (lowestNestedPriority < lowestNestedChildPriority) {
				lowestIndex = i;
				lowestNestedChildPriority = lowestNestedPriority;
			}
		}
	}

	const lowest = children[lowestIndex];
	if (lowest instanceof MaterializedChatMessageTextChunk) {
		children.splice(lowestIndex, 1);
	} else {
		lowest.removeLowestPriorityChild();
		if (lowest.children.length === 0) {
			children.splice(lowestIndex, 1);
		}
	}
}

function getLowestPriorityAmongChildren(node: MaterializedNode): number {
	if (node instanceof MaterializedChatMessageTextChunk) {
		return -1;
	}

	let lowest = Number.MAX_SAFE_INTEGER;
	for (const child of node.children) {
		lowest = Math.min(lowest, child.priority);
	}

	return lowest;
}

function* allMetadata(node: MaterializedContainer | MaterializedChatMessage): Generator<PromptMetadata> {
	yield* node.metadata;
	for (const child of node.children) {
		if (child instanceof MaterializedChatMessageTextChunk) {
			yield* child.metadata;
		} else {
			yield* allMetadata(child);
		}
	}
}
