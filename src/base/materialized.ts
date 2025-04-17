/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { once } from './once';
import { Raw, toMode } from './output/mode';
import { ToolCall } from './promptElements';
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
	 * Gets whether this node has any content to represent to the model.
	 */
	readonly isEmpty: boolean;
}

interface IMaterializedContainer extends IMaterializedNode {
	/**
	 * Called when children change, so caches can be invalidated.
	 */
	onChunksChange(): void;
}

export type MaterializedNode =
	| GenericMaterializedContainer
	| MaterializedChatMessage
	| MaterializedChatMessageTextChunk
	| MaterializedChatMessageImage
	| MaterializedChatMessageOpaque
	| MaterializedChatMessageCheckpoint;

export const enum ContainerFlags {
	/** It's a {@link LegacyPrioritization} instance */
	IsLegacyPrioritization = 1 << 0,
	/** It's a {@link Chunk} instance */
	IsChunk = 1 << 1,
	/** Priority is passed to children. */
	PassPriority = 1 << 2,
	/** Is an alternate with children  */
	EmptyAlternate = 1 << 3,
}

type ContainerType = MaterializedChatMessage | GenericMaterializedContainer;
type ContentType =
	| MaterializedChatMessageTextChunk
	| MaterializedChatMessageImage
	| MaterializedChatMessageOpaque
	| MaterializedChatMessageCheckpoint;

export class GenericMaterializedContainer implements IMaterializedContainer {
	public readonly children: MaterializedNode[];

	public keepWithId?: number;

	constructor(
		public readonly parent: ContainerType | undefined,
		public readonly id: number,
		public readonly name: string | undefined,
		public readonly priority: number,
		childrenRef: (parent: GenericMaterializedContainer) => MaterializedNode[],
		public readonly metadata: PromptMetadata[],
		public readonly flags: number
	) {
		this.children = childrenRef(this);

		if (flags & ContainerFlags.EmptyAlternate) {
			if (this.children.length !== 2) {
				throw new Error('Invalid number of children for EmptyAlternate flag');
			}

			const [ifEmpty, defaultChild] = this.children;
			if (defaultChild.isEmpty) {
				this.children = [ifEmpty];
			} else {
				this.children = [defaultChild];
			}
		}
	}

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
	findById(nodeId: number): ContainerType | undefined {
		return findNodeById(nodeId, this);
	}

	/**
	 * Gets whether the container is empty.
	 */
	get isEmpty(): boolean {
		return !this.children.some(c => !c.isEmpty);
	}

	/**
	 * Called when children change, so caches can be invalidated.
	 */
	onChunksChange(): void {
		this.parent?.onChunksChange();
	}

	/**
	 * Gets the chat messages the container holds.
	 */
	*toChatMessages(): Generator<Raw.ChatMessage> {
		for (const child of this.children) {
			assertContainerOrChatMessage(child);
			if (child instanceof GenericMaterializedContainer) {
				yield* child.toChatMessages();
			} else if (!child.isEmpty && child instanceof MaterializedChatMessage) {
				// note: empty messages are already removed during pruning, but the
				// consumer might themselves have given us empty messages that we should omit.
				yield child.toChatMessage();
			}
		}
	}

	async baseMessageTokenCount(tokenizer: ITokenizer): Promise<number> {
		let sum = 0;
		await Promise.all(
			this.children.map(async child => {
				if (
					child instanceof MaterializedChatMessage ||
					child instanceof GenericMaterializedContainer
				) {
					const amount = await child.baseMessageTokenCount(tokenizer);
					sum += amount;
				}
			})
		);

		return sum;
	}

	/**
	 * Removes the node in the tree with the lowest priority. Returns the
	 * list of nodes that were removed.
	 */
	removeLowestPriorityChild(): MaterializedNode[] {
		const removed: MaterializedNode[] = [];
		removeLowestPriorityChild(this, removed);
		return removed;
	}
}

export const enum LineBreakBefore {
	None,
	Always,
	IfNotTextSibling,
}

/** A chunk of text in a {@link MaterializedChatMessage} */
export class MaterializedChatMessageTextChunk implements IMaterializedNode {
	constructor(
		public readonly parent: ContainerType | undefined,
		public readonly text: string,
		public readonly priority: number,
		public readonly metadata: PromptMetadata[] = [],
		public readonly lineBreakBefore: LineBreakBefore
	) {}

	public upperBoundTokenCount(tokenizer: ITokenizer) {
		return this._upperBound(tokenizer);
	}

	private readonly _upperBound = once(async (tokenizer: ITokenizer) => {
		const textTokens = await tokenizer.tokenLength({
			type: Raw.ChatCompletionContentPartKind.Text,
			text: this.text,
		});
		return textTokens + (this.lineBreakBefore !== LineBreakBefore.None ? 1 : 0);
	});

	public get isEmpty() {
		return !/\S/.test(this.text);
	}
}

export class MaterializedChatMessage implements IMaterializedNode {
	public readonly children: MaterializedNode[];

	constructor(
		public readonly parent: ContainerType | undefined,
		public readonly id: number,
		public readonly role: Raw.ChatRole,
		public readonly name: string | undefined,
		public toolCalls: readonly ToolCall[] | undefined,
		public readonly toolCallId: string | undefined,
		public readonly priority: number,
		public readonly metadata: PromptMetadata[],
		childrenRef: (parent: MaterializedChatMessage) => MaterializedNode[]
	) {
		this.children = childrenRef(this);
	}

	/** @inheritdoc */
	public async tokenCount(tokenizer: ITokenizer): Promise<number> {
		return this._tokenCount(tokenizer);
	}

	/** @inheritdoc */
	public async upperBoundTokenCount(tokenizer: ITokenizer): Promise<number> {
		return this._upperBound(tokenizer);
	}

	/** Gets the text this message contains */
	public get text(): (
		| string
		| MaterializedChatMessageImage
		| MaterializedChatMessageOpaque
		| MaterializedChatMessageCheckpoint
	)[] {
		return this._text();
	}

	/** Gets whether the message is empty */
	public get isEmpty(): boolean {
		return !this.toolCalls?.length && !this.children.some(element => !element.isEmpty);
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

	removeLowestPriorityChild(): MaterializedNode[] {
		const removed: MaterializedNode[] = [];
		removeLowestPriorityChild(this, removed);
		return removed;
	}
	onChunksChange() {
		this._tokenCount.clear();
		this._upperBound.clear();
		this._text.clear();
		this.parent?.onChunksChange();
	}

	/**
	 * Finds a node in the tree by ID.
	 */
	findById(
		nodeId: number
	):
		| GenericMaterializedContainer
		| MaterializedChatMessage
		| MaterializedChatMessageImage
		| undefined {
		return findNodeById(nodeId, this);
	}

	private readonly _tokenCount = once(async (tokenizer: ITokenizer) => {
		const raw = this.toChatMessage();
		return tokenizer.countMessageTokens(toMode(tokenizer.mode, raw));
	});

	private readonly _upperBound = once(async (tokenizer: ITokenizer) => {
		let total = await this.baseMessageTokenCount(tokenizer);
		await Promise.all(
			this.children.map(async chunk => {
				const amt = await chunk.upperBoundTokenCount(tokenizer);
				total += amt;
			})
		);
		return total;
	});

	public readonly baseMessageTokenCount = once((tokenizer: ITokenizer) => {
		const raw = this.toChatMessage();

		raw.content = raw.content
			.map(message => {
				if (message.type === Raw.ChatCompletionContentPartKind.Text) {
					return { ...message, text: '' };
				} else if (message.type === Raw.ChatCompletionContentPartKind.Image) {
					return undefined;
				} else {
					return message;
				}
			})
			.filter(r => !!r);

		return tokenizer.countMessageTokens(toMode(tokenizer.mode, raw));
	});

	private readonly _text = once(() => {
		let result: (
			| string
			| MaterializedChatMessageImage
			| MaterializedChatMessageOpaque
			| MaterializedChatMessageCheckpoint
		)[] = [];
		for (const { content, isTextSibling } of contentChunks(this)) {
			if (
				content instanceof MaterializedChatMessageImage ||
				content instanceof MaterializedChatMessageOpaque
			) {
				result.push(content);
				continue;
			}
			if (content instanceof MaterializedChatMessageCheckpoint) {
				if (result.at(-1) instanceof MaterializedChatMessageCheckpoint) {
					result[result.length - 1] = content;
				} else {
					result.push(content);
				}
				continue;
			}
			if (
				content.lineBreakBefore === LineBreakBefore.Always ||
				(content.lineBreakBefore === LineBreakBefore.IfNotTextSibling && !isTextSibling)
			) {
				let prev = result[result.length - 1];
				if (typeof prev === 'string' && prev && !prev.endsWith('\n')) {
					result[result.length - 1] = prev + '\n';
				}
			}

			if (typeof result[result.length - 1] === 'string') {
				result[result.length - 1] += content.text;
			} else {
				result.push(content.text);
			}
		}

		return result;
	});

	public toChatMessage(): Raw.ChatMessage {
		const content = this.text.map((element): Raw.ChatCompletionContentPart => {
			if (typeof element === 'string') {
				return { type: Raw.ChatCompletionContentPartKind.Text, text: element }; // updated type reference
			} else if (element instanceof MaterializedChatMessageImage) {
				return {
					type: Raw.ChatCompletionContentPartKind.Image, // updated type reference
					imageUrl: { url: getEncodedBase64(element.src), detail: element.detail },
				};
			} else if (element instanceof MaterializedChatMessageOpaque) {
				return element.value as any;
			} else if (element instanceof MaterializedChatMessageCheckpoint) {
				return element.part;
			} else {
				throw new Error('Unexpected element type');
			}
		});

		if (this.role === Raw.ChatRole.System) {
			return {
				role: this.role,
				content,
				...(this.name ? { name: this.name } : {}),
			};
		} else if (this.role === Raw.ChatRole.Assistant) {
			const msg: Raw.AssistantChatMessage = { role: this.role, content };
			if (this.name) {
				msg.name = this.name;
			}
			if (this.toolCalls?.length) {
				msg.toolCalls = this.toolCalls.map(tc => ({
					function: tc.function,
					id: tc.id,
					type: tc.type,
				}));
			}
			return msg;
		} else if (this.role === Raw.ChatRole.User) {
			return {
				role: this.role,
				content,
				...(this.name ? { name: this.name } : {}),
			};
		} else if (this.role === Raw.ChatRole.Tool) {
			return {
				role: this.role,
				content,
				toolCallId: this.toolCallId!,
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

export class MaterializedChatMessageOpaque {
	public readonly metadata: PromptMetadata[] = [];
	public readonly priority = Number.MAX_SAFE_INTEGER;

	public get value() {
		return this.part.value;
	}

	constructor(
		public readonly parent: ContainerType | undefined,
		private readonly part: Raw.ChatCompletionContentPartOpaque
	) {}

	public upperBoundTokenCount(tokenizer: ITokenizer) {
		return this.part.tokenUsage &&
			Raw.ChatCompletionContentPartOpaque.usableIn(this.part, tokenizer.mode)
			? this.part.tokenUsage
			: 0;
	}

	isEmpty: boolean = false;
}

export class MaterializedChatMessageCheckpoint {
	public readonly metadata: PromptMetadata[] = [];
	public readonly priority = Number.MAX_SAFE_INTEGER;

	constructor(
		public readonly parent: ContainerType | undefined,
		public readonly part: Raw.ChatCompletionContentPartCacheCheckpoint
	) {}

	public upperBoundTokenCount(_tokenizer: ITokenizer) {
		return 0;
	}

	isEmpty: boolean = false;
}

export class MaterializedChatMessageImage {
	constructor(
		public readonly parent: ContainerType | undefined,
		public readonly id: number,
		public readonly src: string,
		public readonly priority: number,
		public readonly metadata: PromptMetadata[] = [],
		public readonly lineBreakBefore: LineBreakBefore,
		public readonly detail?: 'low' | 'high'
	) {}

	public upperBoundTokenCount(tokenizer: ITokenizer) {
		return this._upperBound(tokenizer);
	}

	private readonly _upperBound = once(async (tokenizer: ITokenizer) => {
		return tokenizer.tokenLength({
			type: Raw.ChatCompletionContentPartKind.Image,
			imageUrl: { url: getEncodedBase64(this.src), detail: this.detail },
		});
	});

	isEmpty: boolean = false;
}

function isContainerType(node: MaterializedNode): node is ContainerType {
	return node instanceof GenericMaterializedContainer || node instanceof MaterializedChatMessage;
}

function isContentType(node: MaterializedNode): node is ContentType {
	return (
		node instanceof MaterializedChatMessageTextChunk ||
		node instanceof MaterializedChatMessageImage ||
		node instanceof MaterializedChatMessageOpaque ||
		node instanceof MaterializedChatMessageCheckpoint
	);
}

function assertContainerOrChatMessage(v: MaterializedNode): asserts v is ContainerType {
	if (!isContainerType(v)) {
		throw new Error(`Cannot have a text node outside a ChatMessage. Text: "${(v as any).text}"`);
	}
}

function* contentChunks(
	node: ContainerType,
	isTextSibling = false
): Generator<{
	content: ContentType;
	isTextSibling: boolean;
}> {
	for (const child of node.children) {
		if (child instanceof MaterializedChatMessageTextChunk) {
			yield { content: child, isTextSibling };
			isTextSibling = true;
		} else if (
			child instanceof MaterializedChatMessageImage ||
			child instanceof MaterializedChatMessageOpaque ||
			child instanceof MaterializedChatMessageCheckpoint
		) {
			yield { content: child, isTextSibling: false };
		} else if (child instanceof MaterializedChatMessageOpaque) {
			yield { content: child, isTextSibling: true };
		} else {
			if (child) yield* contentChunks(child, isTextSibling);
			isTextSibling = false;
		}
	}
}

function removeLowestPriorityLegacy(root: MaterializedNode, removed: MaterializedNode[]) {
	let lowest:
		| undefined
		| {
				chain: ContainerType[];
				node: ContentType;
		  };

	function findLowestInTree(node: MaterializedNode, chain: ContainerType[]) {
		if (isContentType(node)) {
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

	removeNode(lowest.node, removed);
}

// Cache points are never removed, so caching this is safe
const _hasCachePointMemo = new WeakMap<MaterializedNode, boolean>();

function hasCachePoint(node: MaterializedNode) {
	let known = _hasCachePointMemo.get(node);
	if (known !== undefined) {
		return known;
	}

	let result = false;
	if (node instanceof MaterializedChatMessageCheckpoint) {
		result = true;
	} else if (node instanceof MaterializedChatMessage) {
		result = node.children.some(c => c instanceof MaterializedChatMessageCheckpoint);
	} else if (node instanceof GenericMaterializedContainer) {
		result = node.children.some(hasCachePoint);
	}
	_hasCachePointMemo.set(node, result);

	return result;
}

/**
 * Returns if removeLowestPriorityChild should check for cache checkpoints in
 * the node. This is true only if we aren't nested inside a chat message yet.
 */
function shouldLookForCachePointInNode(node: ContainerType) {
	if (node instanceof MaterializedChatMessage) {
		return true;
	}
	for (let p = node.parent; p; p = p.parent) {
		if (p instanceof MaterializedChatMessage) {
			return false;
		}
	}
	return true;
}

function removeLowestPriorityChild(node: ContainerType, removed: MaterializedNode[]) {
	let lowest:
		| undefined
		| {
				chain: ContainerType[];
				index: number;
				value: MaterializedNode;
				lowestNested?: number;
		  };

	if (
		node instanceof GenericMaterializedContainer &&
		node.has(ContainerFlags.IsLegacyPrioritization)
	) {
		removeLowestPriorityLegacy(node, removed);
		return;
	}

	const shouldLookForCachePoint = shouldLookForCachePointInNode(node);

	// In *most* cases the chain is always [node], but it can be longer if
	// the `passPriority` is used. We need to keep track of the chain to
	// call `onChunksChange` as necessary.
	const queue = node.children.map((_, i) => ({ chain: [node], index: i }));
	for (let i = 0; i < queue.length; i++) {
		const { chain, index } = queue[i];
		const child = chain[chain.length - 1].children[index];

		// When a cache point or node containing a cachepoint is encountered, we
		// should reset the 'lowest' node because we will not prune anything before
		// that point.
		if (shouldLookForCachePoint && hasCachePoint(child)) {
			lowest = undefined;
			if (child instanceof MaterializedChatMessageCheckpoint) {
				continue;
			}
		}

		if (child instanceof GenericMaterializedContainer && child.has(ContainerFlags.PassPriority)) {
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
		throw new BudgetExceededError(node);
	}

	if (
		isContentType(lowest.value) ||
		(lowest.value instanceof GenericMaterializedContainer &&
			lowest.value.has(ContainerFlags.IsChunk)) ||
		(isContainerType(lowest.value) && !lowest.value.children.length)
	) {
		removeNode(lowest.value, removed);
	} else {
		removeLowestPriorityChild(lowest.value, removed);
	}
}

/** Thrown when the TSX budget is exceeded and we can't remove elements to reduce it. */
export class BudgetExceededError extends Error {
	constructor(node: ContainerType) {
		let path = [node];
		while (path[0].parent) {
			path.unshift(path[0].parent);
		}

		const parts = path.map(n =>
			n instanceof MaterializedChatMessage ? n.role : n.name || '(anonymous)'
		);
		super(`No lowest priority node found (path: ${parts.join(' -> ')})`);
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

function* allMetadata(node: ContainerType): Generator<PromptMetadata> {
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
				(withNode as any).parent = child.parent;
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

function* forEachNode(node: MaterializedNode) {
	const queue: MaterializedNode[] = [node];

	while (queue.length > 0) {
		const current = queue.pop()!;
		yield current;
		if (isContainerType(current)) {
			queue.push(...current.children);
		}
	}
}

function getRoot(node: MaterializedNode): GenericMaterializedContainer {
	let current = node;
	while (current.parent) {
		current = current.parent;
	}

	return current as GenericMaterializedContainer;
}

function isKeepWith(
	node: MaterializedNode
): node is GenericMaterializedContainer & { keepWithId: number } {
	return node instanceof GenericMaterializedContainer && node.keepWithId !== undefined;
}

/** Global list of 'keepWiths' currently being removed to avoid recursing indefinitely */
const currentlyBeingRemovedKeepWiths = new Set<number>();

function removeOtherKeepWiths(nodeThatWasRemoved: MaterializedNode, removed: MaterializedNode[]) {
	const removeKeepWithIds = new Set<number>();
	for (const node of forEachNode(nodeThatWasRemoved)) {
		if (isKeepWith(node) && !currentlyBeingRemovedKeepWiths.has(node.keepWithId)) {
			removeKeepWithIds.add(node.keepWithId);
		}
	}

	if (removeKeepWithIds.size === 0) {
		return false;
	}

	for (const id of removeKeepWithIds) {
		currentlyBeingRemovedKeepWiths.add(id);
	}

	try {
		const root = getRoot(nodeThatWasRemoved);
		for (const node of forEachNode(root)) {
			if (isKeepWith(node) && removeKeepWithIds.has(node.keepWithId)) {
				removeNode(node, removed);
			} else if (node instanceof MaterializedChatMessage && node.toolCalls) {
				node.toolCalls = filterIfDifferent(
					node.toolCalls,
					c => !(c.keepWith && removeKeepWithIds.has(c.keepWith.id))
				);

				if (node.isEmpty) {
					// may have become empty if it only contained tool calls
					removeNode(node, removed);
				}
			}
		}
	} finally {
		for (const id of removeKeepWithIds) {
			currentlyBeingRemovedKeepWiths.delete(id);
		}
	}
}

function findNodeById(nodeId: number, container: ContainerType): ContainerType | undefined {
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

function removeNode(node: MaterializedNode, removed: MaterializedNode[]) {
	const parent = node.parent;
	if (!parent) {
		return; // root
	}

	const index = parent.children.indexOf(node);
	if (index === -1) {
		return;
	}

	parent.children.splice(index, 1);
	removed.push(node);
	removeOtherKeepWiths(node, removed);

	if (parent.isEmpty) {
		removeNode(parent, removed);
	} else {
		parent.onChunksChange();
	}
}

function getEncodedBase64(base64String: string): string {
	const mimeTypes: { [key: string]: string } = {
		'/9j/': 'image/jpeg',
		iVBOR: 'image/png',
		R0lGOD: 'image/gif',
		UklGR: 'image/webp',
	};

	for (const prefix of Object.keys(mimeTypes)) {
		if (base64String.startsWith(prefix)) {
			return `data:${mimeTypes[prefix]};base64,${base64String}`;
		}
	}

	return base64String;
}

/** Like Array.filter(), but only clones the array if a change is made */
function filterIfDifferent<T>(arr: readonly T[], predicate: (item: T) => boolean): readonly T[] {
	for (let i = 0; i < arr.length; i++) {
		if (predicate(arr[i])) {
			continue;
		}

		const newArr = arr.slice(0, i);
		for (let k = i + 1; k < arr.length; k++) {
			if (predicate(arr[k])) {
				newArr.push(arr[k]);
			}
		}
		return newArr;
	}

	return arr;
}
