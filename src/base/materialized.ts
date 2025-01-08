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

export type MaterializedNode =
	| MaterializedContainer
	| MaterializedChatMessage
	| MaterializedChatMessageTextChunk
	| MaterializedChatMesageImage;

export const enum ContainerFlags {
	/** It's a {@link LegacyPrioritization} instance */
	IsLegacyPrioritization = 1 << 0,
	/** It's a {@link Chunk} instance */
	IsChunk = 1 << 1,
	/** Priority is passed to children. */
	PassPriority = 1 << 2,
}

export class MaterializedContainer implements IMaterializedNode {
	constructor(
		public readonly id: number,
		public readonly name: string | undefined,
		public readonly priority: number,
		public readonly children: MaterializedNode[],
		public readonly metadata: PromptMetadata[],
		public readonly flags: number
	) {}

	public has(flag: ContainerFlags) {
		return !!(this.flags & flag);
	}

	/** @inheritdoc */
	async tokenCount(tokenizer: ITokenizer): Promise<number> {
		let total = 0;
		await Promise.all(
			this.children.map(async child => {
				const amt = isContainerType(child)
					? await child.tokenCount(tokenizer)
					: await child.upperBoundTokenCount(tokenizer);
				total += amt;
			})
		);
		return total;
	}

	/** @inheritdoc */
	async upperBoundTokenCount(tokenizer: ITokenizer): Promise<number> {
		let total = 0;
		await Promise.all(
			this.children.map(async child => {
				const amt = await child.upperBoundTokenCount(tokenizer);
				total += amt;
			})
		);
		return total;
	}

	/**
	 * Replaces a node in the tree with the given one, by its ID.
	 */
	replaceNode(nodeId: number, withNode: MaterializedNode): MaterializedNode | undefined {
		return replaceNode(nodeId, this.children, withNode);
	}

	/**
	 * Gets all metadata the container holds.
	 */
	allMetadata(): Generator<PromptMetadata> {
		return allMetadata(this);
	}

	/**
	 * Finds a node in the tree by ID.
	 */
	findById(nodeId: number): MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage | undefined {
		return findNodeById(nodeId, this);
	}

	/**
	 * Gets the chat messages the container holds.
	 */
	*toChatMessages(): Generator<ChatMessage> {
		for (const child of this.children) {
			assertContainerOrChatMessage(child);
			if (child instanceof MaterializedContainer) {
				yield* child.toChatMessages();
			} else if (!child.isEmpty && child instanceof MaterializedChatMessage) {
				// note: empty messages are already removed during pruning, but the
				// consumer might themselves have given us empty messages that we should omit.
				yield child.toChatMessage();
			}
		}
	}

	/** Removes the node in the tree with the lowest priority. */
	removeLowestPriorityChild(): void {
		if (this.has(ContainerFlags.IsLegacyPrioritization)) {
			removeLowestPriorityLegacy(this);
		} else {
			removeLowestPriorityChild(this);
		}
	}
}

export const enum LineBreakBefore {
	None,
	Always,
	IfNotTextSibling,
}

/** A chunk of text in a {@link MaterializedChatMessage} */
export class MaterializedChatMessageTextChunk {
	constructor(
		public readonly text: string,
		public readonly priority: number,
		public readonly metadata: PromptMetadata[] = [],
		public readonly lineBreakBefore: LineBreakBefore
	) {}

	public upperBoundTokenCount(tokenizer: ITokenizer) {
		return this._upperBound(tokenizer);
	}

	private readonly _upperBound = once(async (tokenizer: ITokenizer) => {
		return (
			(await tokenizer.tokenLength(this.text)) +
			(this.lineBreakBefore !== LineBreakBefore.None ? 1 : 0)
		);
	});
}

export class MaterializedChatMessage implements IMaterializedNode {
	constructor(
		public readonly id: number,
		public readonly role: ChatRole,
		public readonly name: string | undefined,
		public readonly toolCalls: ChatMessageToolCall[] | undefined,
		public readonly toolCallId: string | undefined,
		public readonly priority: number,
		public readonly metadata: PromptMetadata[],
		public readonly children: MaterializedNode[]
	) {}

	/** @inheritdoc */
	public async tokenCount(tokenizer: ITokenizer): Promise<number> {
		return this._tokenCount(tokenizer);
	}

	/** @inheritdoc */
	public async upperBoundTokenCount(tokenizer: ITokenizer): Promise<number> {
		return this._upperBound(tokenizer);
	}

	/** Gets the text this message contains */
	public get text(): (string | MaterializedChatMesageImage)[] {
		return this._text();
	}

	/** Gets whether the message is empty */
	public get isEmpty() {
		const content = this.text
			.filter(element => typeof element === 'string')
			.join('').trimEnd();

		return !this.toolCalls?.length && !this.text.some(element => element instanceof MaterializedChatMesageImage || /\S/.test(content));
	}

	/**
	 * Replaces a node in the tree with the given one, by its ID.
	 */
	replaceNode(nodeId: number, withNode: MaterializedNode): MaterializedNode | undefined {
		const replaced = replaceNode(nodeId, this.children, withNode);
		if (replaced) {
			this.onChunksChange();
		}

		return replaced;
	}

	/** Remove the lowest priority chunk among this message's children. */
	removeLowestPriorityChild() {
		removeLowestPriorityChild(this);
	}

	onChunksChange() {
		this._tokenCount.clear();
		this._upperBound.clear();
		this._text.clear();
	}

	/**
	 * Finds a node in the tree by ID.
	 */
	findById(nodeId: number): MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage | undefined {
		return findNodeById(nodeId, this);
	}

	private readonly _tokenCount = once(async (tokenizer: ITokenizer) => {
		return tokenizer.countMessageTokens(this.toChatMessage());
	});

	private readonly _upperBound = once(async (tokenizer: ITokenizer) => {
		let total = await this._baseMessageTokenCount(tokenizer);
		await Promise.all(
			this.children.map(async chunk => {
				const amt = await chunk.upperBoundTokenCount(tokenizer);
				total += amt;
			})
		);
		return total;
	});

	private readonly _baseMessageTokenCount = once((tokenizer: ITokenizer) => {
		return tokenizer.countMessageTokens({ ...this.toChatMessage(), content: '' });
	});

	private readonly _text = once((): (string | MaterializedChatMesageImage)[] => {
		let result: (string | MaterializedChatMesageImage)[] = [];
		for (const { text, isTextSibling } of textChunks(this)) {
			if (text instanceof MaterializedChatMesageImage) {
				result.push(text);
				break;
			}
			if (
				text.lineBreakBefore === LineBreakBefore.Always ||
				(text.lineBreakBefore === LineBreakBefore.IfNotTextSibling && !isTextSibling)
			) {
				let prev = result[result.length - 1]
				if (typeof prev === 'string' && result.length && !prev.endsWith('\n')) {
					result.push('\n');
				}
			}

			if (typeof result[result.length - 1] === 'string') {
				result[result.length - 1] += text.text;
			} else {
				result.push(text.text);
			}
		}

		return result;
	});

	public toChatMessage(): ChatMessage {
		const content = this.text
			.filter(element => typeof element === 'string')
			.join('').trim();

		const images = this._text().filter(element => element instanceof MaterializedChatMesageImage) as MaterializedChatMesageImage[];

		if (images.length > 0) {
			return {
				role: ChatRole.User,
				content: [
					{ type: 'text', text: content },
					{
						type: 'image_url',
						image_url: { url: getEncodedBase64(images[0].imageUrl), detail: images[0].detail },
					}],
			};
		}

		if (this.role === ChatRole.System) {
			return {
				role: this.role,
				content,
				...(this.name ? { name: this.name } : {}),
			};
		} else if (this.role === ChatRole.Assistant) {
			return {
				role: this.role,
				content,
				...(this.toolCalls ? { tool_calls: this.toolCalls } : {}),
				...(this.name ? { name: this.name } : {}),
			};
		} else if (this.role === ChatRole.User) {
			return {
				role: this.role,
				content,
				...(this.name ? { name: this.name } : {}),
			};
		} else if (this.role === ChatRole.Tool) {
			return {
				role: this.role,
				content,
				tool_call_id: this.toolCallId,
			};
		} else {
			return {
				role: this.role,
				content,
				name: this.name!,
			};
		}
	}
}

export class MaterializedChatMesageImage implements IMaterializedNode {
	constructor(
		public readonly id: number,
		public readonly role: ChatRole,
		public readonly imageUrl: string,
		public readonly priority: number,
		public readonly metadata: PromptMetadata[] = [],
		public readonly lineBreakBefore: LineBreakBefore,
		public readonly children: MaterializedNode[],
		public readonly detail?: 'low' | 'high',
	) { }
	upperBoundTokenCount(tokenizer: ITokenizer): Promise<number> {
		return this.upperBoundTokenCount(tokenizer);
	}
	tokenCount(tokenizer: ITokenizer): Promise<number> {
		return this._tokenCount(tokenizer);
	}

	private readonly _tokenCount = once(async (tokenizer: ITokenizer) => {
		return 0;
	});

	removeLowestPriorityChild(): void {
		removeLowestPriorityChild(this);
	}

	/**
	 * Replaces a node in the tree with the given one, by its ID.
	 */
	replaceNode(nodeId: number, withNode: MaterializedNode): MaterializedNode | undefined {
		return replaceNode(nodeId, this.children, withNode);
	}

	/**
	 * Finds a node in the tree by ID.
	 */
	findById(nodeId: number): MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage | undefined {
		return findNodeById(nodeId, this);
	}

	isEmpty: boolean = false;
}

function isContainerType(
	node: MaterializedNode
): node is MaterializedContainer | MaterializedChatMessage {
	return !(node instanceof MaterializedChatMessageTextChunk);
}

function assertContainerOrChatMessage(
	v: MaterializedNode
): asserts v is MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage {
	if (!(v instanceof MaterializedContainer) && !(v instanceof MaterializedChatMessage) && !(v instanceof MaterializedChatMesageImage)) {
		throw new Error(`Cannot have a text node outside a ChatMessage. Text: "${v.text}"`);
	}
}

function* textChunks(
	node: MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage,
	isTextSibling = false
): Generator<{ text: MaterializedChatMessageTextChunk | MaterializedChatMesageImage; isTextSibling: boolean }> {
	for (const child of node.children) {
		if (child instanceof MaterializedChatMessageTextChunk) {
			yield { text: child, isTextSibling };
			isTextSibling = true;
		} else if (child instanceof MaterializedChatMesageImage) {
			yield { text: child, isTextSibling: false };
		} else {
			if (child)
				yield* textChunks(child, isTextSibling);
			isTextSibling = false;
		}
	}
}

function removeLowestPriorityLegacy(root: MaterializedNode) {
	let lowest:
		| undefined
		| {
			chain: (MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage)[];
			node: MaterializedChatMessageTextChunk;
		};

	function findLowestInTree(
		node: MaterializedNode,
		chain: (MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage)[]
	) {
		if (node instanceof MaterializedChatMessageTextChunk) {
			if (!lowest || node.priority < lowest.node.priority) {
				lowest = { chain: chain.slice(), node };
			}
		} else {
			chain.push(node);
			for (const child of node.children) {
				findLowestInTree(child, chain);
			}
			chain.pop();
		}
	}

	findLowestInTree(root, []);

	if (!lowest) {
		throw new Error('No lowest priority node found');
	}

	let needle: MaterializedNode = lowest.node;
	let i = lowest.chain.length - 1;
	for (; i >= 0; i--) {
		const node = lowest.chain[i];
		node.children.splice(node.children.indexOf(needle), 1);
		if (node instanceof MaterializedChatMessage) {
			node.onChunksChange();
		}
		if (node.children.length > 0) {
			break;
		}

		needle = node;
	}

	for (; i >= 0; i--) {
		const node = lowest.chain[i];
		if (node instanceof MaterializedChatMessage) {
			node.onChunksChange();
		}
	}
}

function removeLowestPriorityChild(node: MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage) {
	let lowest:
		| undefined
		| {
			chain: (MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage)[];
			index: number;
			value: MaterializedNode;
			lowestNested?: number;
		};

	// In *most* cases the chain is always [node], but it can be longer if
	// the `passPriority` is used. We need to keep track of the chain to
	// call `onChunksChange` as necessary.
	const queue = node.children.map((_, i) => ({ chain: [node], index: i }));
	for (let i = 0; i < queue.length; i++) {
		const { chain, index } = queue[i];
		const child = chain[chain.length - 1].children[index];

		if (child instanceof MaterializedContainer && child.has(ContainerFlags.PassPriority)) {
			const newChain = [...chain, child];
			queue.splice(i + 1, 0, ...child.children.map((_, i) => ({ chain: newChain, index: i })));
		} else if (!lowest || child.priority < lowest.value.priority) {
			lowest = { chain, index, value: child };
		} else if (child.priority === lowest.value.priority) {
			// Use the lowest priority of any of their nested remaining children as a tiebreaker,
			// useful e.g. when dealing with root sibling user vs. system messages
			lowest.lowestNested ??= getLowestPriorityAmongChildren(lowest.value);
			const lowestNestedPriority = getLowestPriorityAmongChildren(child);
			if (lowestNestedPriority < lowest.lowestNested) {
				lowest = { chain, index, value: child, lowestNested: lowestNestedPriority };
			}
		}
	}

	if (!lowest) {
		throw new Error('No lowest priority node found');
	}

	const containingList = lowest.chain[lowest.chain.length - 1].children;
	if (
		lowest.value instanceof MaterializedChatMessageTextChunk ||
		(lowest.value instanceof MaterializedContainer && lowest.value.has(ContainerFlags.IsChunk)) ||
		(isContainerType(lowest.value) && !lowest.value.children.length)
	) {
		containingList.splice(lowest.index, 1);
	} else {
		lowest.value.removeLowestPriorityChild();
		if (lowest.value.children.length === 0) {
			containingList.splice(lowest.index, 1);
		}
	}

	for (const node of lowest.chain) {
		if (node instanceof MaterializedChatMessage) {
			node.onChunksChange();
		}
	}
}

function getLowestPriorityAmongChildren(node: MaterializedNode): number {
	if (!isContainerType(node)) {
		return -1;
	}

	let lowest = Number.MAX_SAFE_INTEGER;
	for (const child of node.children) {
		lowest = Math.min(lowest, child.priority);
	}

	return lowest;
}

function* allMetadata(
	node: MaterializedContainer | MaterializedChatMessage
): Generator<PromptMetadata> {
	yield* node.metadata;
	for (const child of node.children) {
		if (isContainerType(child)) {
			yield* allMetadata(child);
		} else {
			yield* child.metadata;
		}
	}
}

function replaceNode(
	nodeId: number,
	children: MaterializedNode[],
	withNode: MaterializedNode
): MaterializedNode | undefined {
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (isContainerType(child)) {
			if (child.id === nodeId) {
				const oldNode = children[i];
				children[i] = withNode;
				return oldNode;
			}

			const inner = child.replaceNode(nodeId, withNode);
			if (inner) {
				return inner;
			}
		}
	}
}

function findNodeById(
	nodeId: number,
	container: MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage
): MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage | undefined {
	if (container.id === nodeId) {
		return container;
	}

	for (const child of container.children) {
		if (isContainerType(child)) {
			const inner = findNodeById(nodeId, child);
			if (inner) {
				return inner;
			}
		}
	}
}

function getEncodedBase64(base64String: string): string {
	const mimeTypes: { [key: string]: string } = {
		'/9j/': 'image/jpeg',
		'iVBOR': 'image/png',
		'R0lGOD': 'image/gif',
		'UklGR': 'image/webp',
	};

	for (const prefix of Object.keys(mimeTypes)) {
		if (base64String.startsWith(prefix)) {
			return `data:${mimeTypes[prefix]};base64,${base64String}`;
		}
	}

	return base64String;

}
