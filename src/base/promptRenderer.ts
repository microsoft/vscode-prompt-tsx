/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from "vscode";
import { BaseTokensPerCompletion, BaseTokensPerMessage, BaseTokensPerName, ChatMessage, ChatRole } from "./openai";
import { PromptElement } from "./promptElement";
import { BaseChatMessage, ChatMessagePromptElement, TextChunk, isChatMessagePromptElement } from "./promptElements";
import { PromptMetadata, PromptReference, ReplyInterpreterFactory } from "./results";
import { Cl100KBaseTokenizerImpl, ITokenizer } from "./tokenizer/tokenizer";
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor, PromptPiece, PromptPieceChild, PromptSizing } from "./types";
import { coalesce } from "./util/arrays";
import { URI } from "./util/vs/common/uri";
import { ChatDocumentContext, ChatResponsePart } from "./vscodeTypes";

export interface RenderPromptResult {
	readonly messages: ChatMessage[];
	readonly tokenCount: number;
	readonly hasIgnoredFiles: boolean;
}

export type QueueItem<C, P> = {
	node: PromptTreeElement;
	ctor: C;
	props: P;
	children: PromptPieceChild[];
};

export interface MetadataMap {
	get<T extends PromptMetadata>(key: new (...args: any[]) => T): T | undefined;
}

export namespace MetadataMap {
	export const empty: MetadataMap = {
		get: () => undefined
	};
}

/**
 * A prompt renderer is responsible for rendering a {@link PromptElementCtor prompt element} to {@link ChatMessagePromptElement chat messages}.
 *
 * Note: You must create a fresh prompt renderer instance for each prompt element you want to render.
 */
export class PromptRenderer<P extends BasePromptElementProps> {

	// map the constructor to the meta data instances
	private readonly _meta: Map<new () => PromptMetadata, PromptMetadata> = new Map();
	private readonly _usedContext: ChatDocumentContext[] = [];
	private readonly _references: PromptReference[] = [];
	private readonly _ignoredFiles: URI[] = [];
	private _replyInterpreterFactory: ReplyInterpreterFactory | null = null;
	private readonly _queue: QueueItem<PromptElementCtor<P, any>, P>[] = [];
	private readonly _root = new PromptTreeElement(null, 0, {
		tokenBudget: this._endpoint.modelMaxPromptTokens,
		endpoint: this._endpoint
	});
	private readonly _tokenizer: ITokenizer;

	/**
	 *
	 * @param _endpoint The chat endpoint that the rendered prompt will be sent to.
	 * @param _ctor The prompt element constructor to render.
	 * @param _props The props to pass to the prompt element.
	 */
	constructor(
		private readonly _endpoint: IChatEndpointInfo,
		private readonly _ctor: PromptElementCtor<P, any>,
		private readonly _props: P,
		_tokenizer?: ITokenizer
	) {
		this._tokenizer = _tokenizer ?? new Cl100KBaseTokenizerImpl();
		this._queue.push({ node: this._root, ctor: this._ctor, props: this._props, children: [] });
	}

	public getAllMeta(): MetadataMap {
		const metadataMap = this._meta;
		return {
			get<T extends PromptMetadata>(key: new (...args: any[]) => T): T | undefined {
				return metadataMap.get(key) as T | undefined;
			}
		};
	}

	public getIgnoredFiles(): URI[] {
		return Array.from(new Set(this._ignoredFiles));
	}

	public getMeta<T extends PromptMetadata>(key: new (...args: any[]) => T): T | undefined {
		return this._meta.get(key) as T | undefined;
	}

	public getUsedContext(): ChatDocumentContext[] {
		return this._usedContext;
	}

	public getReferences(): PromptReference[] {
		return this._references;
	}

	public getReplyInterpreterFactory(): ReplyInterpreterFactory | null {
		return this._replyInterpreterFactory;
	}

	protected createElement(element: QueueItem<PromptElementCtor<P, any>, P>) {
		return new element.ctor(element.props);
	}

	private async _processPromptPieces(progress?: Progress<ChatResponsePart>, token?: CancellationToken) {
		while (this._queue.length > 0) {

			// Collect all prompt elements to render
			const promptElements: { element: any; promptElementInstance: PromptElement<any, any> }[] = [];
			for (const element of this._queue.values()) {
				// Set any jsx children as the props.children
				if (Array.isArray(element.children)) {
					element.props = (element.props ?? {});
					(element.props as any).children = element.children; // todo@joyceerhl clean up any
				}

				// Instantiate the prompt part
				if (!element.ctor) {
					throw new Error(`Invalid ChatMessage child! Child must be a TSX component that extends PromptElement.`);
				}

				const promptElement = this.createElement(element);
				element.node.setObj(promptElement);

				// Prepare rendering
				promptElements.push({ element, promptElementInstance: promptElement });
			}

			// Clear the queue
			this._queue.splice(0, this._queue.length);

			// Prepare all currently known prompt elements in parallel
			await Promise.all(promptElements.map(({ element, promptElementInstance }) => promptElementInstance.prepare?.(element.node.sizing, progress, token).then((state) => element.node.setState(state))));

			// Render
			for (const { element, promptElementInstance } of promptElements) {
				const template = promptElementInstance.render(element.node.getState(), element.node.sizing);

				if (!template) {
					// it doesn't want to render anything
					continue;
				}

				const pieces = flattenAndReduce(template);

				// Compute token budget for the pieces that this child wants to render
				const { flexChildrenSum, parentTokenBudgetWithoutLiterals } = computeTokenBudgetForPieces(this._tokenizer, element, promptElementInstance, pieces);

				for (const piece of pieces) {
					this._handlePromptPiece(element, piece, flexChildrenSum, parentTokenBudgetWithoutLiterals);
				}
			}
		}
	}

	private _prioritize<T extends Countable>(things: T[], cmp: (a: T, b: T) => number, count: (thing: T) => number) {
		const prioritizedChunks: { index: number; precedingLinebreak?: number }[] = []; // sorted by descending priority
		const chunkResult: (T | null)[] = [];

		let i = 0;
		while (i < things.length) {
			// We only consider non-linebreaks for prioritization
			if (!things[i].isImplicitLinebreak) {
				const chunk = things[i - 1]?.isImplicitLinebreak ? { index: i, precedingLinebreak: i - 1 } : { index: i };
				prioritizedChunks.push(chunk);
				chunkResult[i] = null;
			}
			i += 1;
		}

		prioritizedChunks.sort((a, b) => cmp(things[a.index], things[b.index]));

		let remainingBudget = this._endpoint.modelMaxPromptTokens - BaseTokensPerCompletion;
		while (prioritizedChunks.length > 0) {
			const prioritizedChunk = prioritizedChunks.shift()!;
			const index = prioritizedChunk.index;
			const chunk = things[index];
			let tokenCount = count(chunk);
			let precedingLinebreak;
			if (prioritizedChunk.precedingLinebreak) {
				precedingLinebreak = things[prioritizedChunk.precedingLinebreak];
				tokenCount += count(precedingLinebreak);
			}
			if (tokenCount > remainingBudget) {
				// Wouldn't fit anymore
				break;
			}
			chunkResult[index] = chunk;
			if (prioritizedChunk.precedingLinebreak && precedingLinebreak) {
				chunkResult[prioritizedChunk.precedingLinebreak] = precedingLinebreak;
			}
			remainingBudget -= tokenCount;
		}

		return { result: chunkResult, tokenCount: this._endpoint.modelMaxPromptTokens - remainingBudget };
	}

	/**
	 * Renders the prompt element and its children.
	 * @returns A promise that resolves to an object containing the rendered chat messages and the total token count.
	 * The total token count is guaranteed to be less than or equal to the token budget.
	 */
	public async render(progress?: Progress<ChatResponsePart>, token?: CancellationToken): Promise<RenderPromptResult> {
		// Convert root prompt element to prompt pieces
		await this._processPromptPieces(progress, token);

		// Convert prompt pieces to message chunks (text and linebreaks)
		const { result: messages, resultChunks } = this._root.materialize();

		// First pass: sort message chunks by priority. Note that this can yield an imprecise result due to token boundaries within a single chat message
		// so we also need to do a second pass over the full chat messages later
		const chunkMessages = new Set<MaterializedChatMessage>();
		const { result: prioritizedChunks } = this._prioritize(
			resultChunks,
			(a, b) => MaterializedChatMessageTextChunk.cmp(a, b),
			(chunk) => {
				let tokenLength = this._tokenizer.tokenLength(chunk.text);
				if (!chunkMessages.has(chunk.message)) {
					chunkMessages.add(chunk.message);
					tokenLength = this._tokenizer.countMessageTokens(chunk.toChatMessage());
				}
				return tokenLength;
			});

		// Update chat messages with their chunks that survived prioritization
		const chatMessagesToChunks = new Map<MaterializedChatMessage, MaterializedChatMessageTextChunk[]>();
		for (const chunk of coalesce(prioritizedChunks)) {
			const value = chatMessagesToChunks.get(chunk.message) ?? [];
			value[chunk.childIndex] = chunk;
			chatMessagesToChunks.set(chunk.message, value);
		}

		// Collect chat messages with surviving prioritized chunks in the order they were declared
		const chatMessages: MaterializedChatMessage[] = [];
		for (const message of messages) {
			const chunks = chatMessagesToChunks.get(message);
			if (chunks) {
				message.chunks = coalesce(chunks);
				chatMessages.push(message);
			}
		}

		// Second pass: make sure the chat messages will fit within the token budget
		const { result: prioritizedMaterializedChatMessages, tokenCount } = this._prioritize(chatMessages, (a, b) => MaterializedChatMessage.cmp(a, b), (message) => this._tokenizer.countMessageTokens(message.toChatMessage()));

		// Then finalize the chat messages
		const messageResult = prioritizedMaterializedChatMessages.map(message => message?.toChatMessage());

		return { messages: this._validate(coalesce(messageResult)), hasIgnoredFiles: this._ignoredFiles.length > 0, tokenCount };
	}

	private _validate(chatMessages: ChatMessage[]) {
		const lastMessage = chatMessages[chatMessages.length - 1];
		if (lastMessage && lastMessage.role !== ChatRole.User) {
			// User message was dropped, which will result in a 400 error from the server
			console.error('Sorry, this message is too long. Please try a shorter question.');
		}

		return chatMessages;
	}

	private _handlePromptPiece(element: QueueItem<PromptElementCtor<P, any>, P>, piece: ProcessedPromptPiece, siblingflexSum: number, parentTokenBudget: number) {
		if (piece.kind === 'literal') {
			element.node.appendStringChild(piece.value, element.props.priority ?? Number.MAX_SAFE_INTEGER);
			return;
		}
		if (piece.kind === 'intrinsic') {
			// intrinsic element
			this._handleIntrinsic(element.node, piece.name, { priority: element.props.priority ?? Number.MAX_SAFE_INTEGER, ...piece.props }, flattenAndReduceArr(piece.children));
			return;
		}
		if (piece.ctor === TextChunk) {
			// text chunk
			this._handleExtrinsicTextChunk(element.node, { priority: element.props.priority ?? Number.MAX_SAFE_INTEGER, ...piece.props }, flattenAndReduceArr(piece.children));
			return;
		}

		const childNode = element.node.createChild({
			tokenBudget: Math.floor(parentTokenBudget * (piece.props?.flex ?? 1) / siblingflexSum),
			endpoint: this._endpoint
		});

		this._queue.push({ node: childNode, ctor: piece.ctor, props: { priority: element.props.priority, ...piece.props }, children: piece.children });
	}

	private _handleIntrinsic(node: PromptTreeElement, name: string, props: any, children: ProcessedPromptPiece[]): void {
		switch (name) {
			case 'meta':
				return this._handleIntrinsicMeta(node, props, children);
			case 'br':
				return this._handleIntrinsicLineBreak(node, props, children, props.priority);
			case 'usedContext':
				return this._handleIntrinsicUsedContext(node, props, children);
			case 'references':
				return this._handleIntrinsicReferences(node, props, children);
			case 'ignoredFiles':
				return this._handleIntrinsicIgnoredFiles(node, props, children);
			case 'replyInterpreter':
				return this._handleIntrinsicReplyInterpreter(node, props, children);
		}
		throw new Error(`Unknown intrinsic element ${name}!`);
	}

	private _handleIntrinsicMeta(node: PromptTreeElement, props: JSX.IntrinsicElements['meta'], children: ProcessedPromptPiece[]) {
		if (children.length > 0) {
			throw new Error(`<meta /> must not have children!`);
		}
		const key = Object.getPrototypeOf(props.value).constructor;
		if (this._meta.has(key)) {
			throw new Error(`Duplicate metadata ${key.name}!`);
		}
		this._meta.set(key, props.value);
	}

	private _handleIntrinsicLineBreak(node: PromptTreeElement, props: JSX.IntrinsicElements['br'], children: ProcessedPromptPiece[], inheritedPriority?: number) {
		if (children.length > 0) {
			throw new Error(`<br /> must not have children!`);
		}
		node.appendLineBreak(true, inheritedPriority ?? Number.MAX_SAFE_INTEGER);
	}

	private _handleIntrinsicUsedContext(node: PromptTreeElement, props: JSX.IntrinsicElements['usedContext'], children: ProcessedPromptPiece[]) {
		if (children.length > 0) {
			throw new Error(`<usedContext /> must not have children!`);
		}
		this._usedContext.push(...props.value);
	}

	private _handleIntrinsicReferences(node: PromptTreeElement, props: JSX.IntrinsicElements['references'], children: ProcessedPromptPiece[]) {
		if (children.length > 0) {
			throw new Error(`<reference /> must not have children!`);
		}
		this._references.push(...props.value);
	}


	private _handleIntrinsicIgnoredFiles(node: PromptTreeElement, props: JSX.IntrinsicElements['ignoredFiles'], children: ProcessedPromptPiece[]) {
		if (children.length > 0) {
			throw new Error(`<ignoredFiles /> must not have children!`);
		}
		this._ignoredFiles.push(...props.value);
	}

	private _handleIntrinsicReplyInterpreter(node: PromptTreeElement, props: JSX.IntrinsicElements['replyInterpreter'], children: ProcessedPromptPiece[]) {
		if (children.length > 0) {
			throw new Error(`<replyInterpreter /> must not have children!`);
		}
		this._replyInterpreterFactory = props.value;
	}

	private _handleExtrinsicTextChunk(node: PromptTreeElement, props: BasePromptElementProps, children: ProcessedPromptPiece[]) {
		const content: string[] = [];

		for (const child of children) {
			if (child.kind === 'extrinsic') {
				throw new Error('TextChunk cannot have extrinsic children!');
			}

			if (child.kind === 'literal') {
				content.push(child.value);
			}

			if (child.kind === 'intrinsic') {
				if (child.name === 'br') {
					// Preserve newlines
					content.push('\n');
				} else {
					this._handleIntrinsic(node, child.name, child.props, flattenAndReduceArr(child.children));
				}
			}
		}

		node.appendLineBreak(false);
		node.appendStringChild(content.join(''), props?.priority ?? Number.MAX_SAFE_INTEGER);
	}
}

function computeTokenBudgetForPieces(tokenizer: ITokenizer, element: any, instance: PromptElement<any, any>, pieces: ProcessedPromptPiece[]) {
	let flexChildrenSum = 0;
	let parentTokenBudgetWithoutLiterals = element.node.sizing.tokenBudget;
	if (isChatMessagePromptElement(instance)) {
		parentTokenBudgetWithoutLiterals -= BaseTokensPerMessage;
		if (element.props.name) {
			parentTokenBudgetWithoutLiterals -= BaseTokensPerName;
		}
		if (element.props.role) {
			parentTokenBudgetWithoutLiterals -= tokenizer.tokenLength(element.props.role);
		}
	}
	for (const piece of pieces) {
		if (piece.kind === 'literal') {
			parentTokenBudgetWithoutLiterals -= tokenizer.tokenLength(piece.value);
		} else {
			flexChildrenSum += piece.props?.flex ?? 1;
		}
	}

	return { parentTokenBudgetWithoutLiterals, flexChildrenSum };
}

// Flatten nested fragments and normalize children
function flattenAndReduce(c: string | number | PromptPiece<any> | undefined): ProcessedPromptPiece[] {
	if (typeof c === 'undefined' || typeof c === 'boolean') {
		// booleans are ignored to allow for the pattern: { cond && <Element ... /> }
		return [];
	} else if (typeof c === 'string' || typeof c === 'number') {
		return [new LiteralPromptPiece(String(c))];
	} else if (isFragmentCtor(c)) {
		return [...flattenAndReduceArr(c.children)];
	} else if (typeof c.ctor === 'string') {
		// intrinsic element
		return [new IntrinsicPromptPiece(c.ctor, c.props, c.children)];
	} else {
		// extrinsic element
		return [new ExtrinsicPromptPiece(c.ctor, c.props, c.children)];
	}
}

function flattenAndReduceArr(arr: PromptPieceChild[]): ProcessedPromptPiece[] {
	return (arr ?? []).reduce((r, c) => {
		r.push(...flattenAndReduce(c));
		return r;
	}, [] as ProcessedPromptPiece[]);
}

class IntrinsicPromptPiece<K extends keyof JSX.IntrinsicElements> {
	public readonly kind = 'intrinsic';

	constructor(
		public readonly name: string,
		public readonly props: JSX.IntrinsicElements[K],
		public readonly children: PromptPieceChild[]
	) { }
}

class ExtrinsicPromptPiece<P extends BasePromptElementProps = any, S = any> {
	public readonly kind = 'extrinsic';

	constructor(
		public readonly ctor: PromptElementCtor<P, S>,
		public readonly props: P,
		public readonly children: PromptPieceChild[]
	) { }
}

class LiteralPromptPiece {
	public readonly kind = 'literal';

	constructor(
		public readonly value: string,
		public readonly priority?: number
	) { }
}

type ProcessedPromptPiece = LiteralPromptPiece | IntrinsicPromptPiece<any> | ExtrinsicPromptPiece<any, any>;

const enum PromptNodeType {
	Piece,
	Text,
	LineBreak
}

type PromptNode = PromptTreeElement | PromptText | PromptLineBreak;
type LeafPromptNode = PromptText | PromptLineBreak;

class PromptTreeElement {

	public readonly kind = PromptNodeType.Piece;

	private _obj: PromptElement | null = null;
	private _state: any | undefined = undefined;
	private _children: PromptNode[] = [];

	constructor(
		public readonly parent: PromptTreeElement | null = null,
		public readonly childIndex: number,
		private _sizing: PromptSizing
	) { }

	public set sizing(sizing: PromptSizing) {
		this._sizing = sizing;
	}

	public get sizing() {
		return this._sizing;
	}

	public setObj(obj: PromptElement) {
		this._obj = obj;
	}

	public setState(state: any) {
		this._state = state;
	}

	public getState(): any {
		return this._state;
	}

	public createChild(sizing: PromptSizing): PromptTreeElement {
		const child = new PromptTreeElement(this, this._children.length, sizing);
		this._children.push(child);
		return child;
	}

	public appendStringChild(text: string, priority?: number): void {
		this._children.push(new PromptText(this, text, priority));
	}

	public appendLineBreak(explicit = true, priority?: number): void {
		this._children.push(new PromptLineBreak(this, explicit, priority));
	}

	public materialize(): { result: MaterializedChatMessage[]; resultChunks: MaterializedChatMessageTextChunk[] } {
		const result: MaterializedChatMessage[] = [];
		const resultChunks: MaterializedChatMessageTextChunk[] = [];
		this._materialize(result, resultChunks);
		return { result, resultChunks };
	}

	private _materialize(result: MaterializedChatMessage[], resultChunks: MaterializedChatMessageTextChunk[]): void {
		if (this._obj instanceof BaseChatMessage) {
			if (!this._obj.props.role) {
				throw new Error(`Invalid ChatMessage!`);
			}
			const leafNodes: LeafPromptNode[] = [];
			for (const child of this._children) {
				child.collectLeafs(leafNodes);
			}
			const chunks: MaterializedChatMessageTextChunk[] = [];
			const parent = new MaterializedChatMessage(
				this._obj.props.role,
				this._obj.props.name,
				this._obj.props.priority,
				this.childIndex,
				chunks
			);
			let childIndex = resultChunks.length;
			leafNodes.forEach((node, index) => {
				if (node.kind === PromptNodeType.Text) {
					chunks.push(new MaterializedChatMessageTextChunk(parent, node.text, node.priority, childIndex++));
				} else {
					if (node.isExplicit) {
						chunks.push(new MaterializedChatMessageTextChunk(parent, '\n', node.priority, childIndex++));
					} else if (chunks.length > 0 && chunks[chunks.length - 1].text !== '\n' || chunks[index - 1] && chunks[index - 1].text !== '\n') {
						// Only insert an implicit linebreak if there wasn't already an explicit linebreak before
						chunks.push(new MaterializedChatMessageTextChunk(parent, '\n', node.priority, childIndex++, true));
					}
				}
			});
			resultChunks.push(...chunks);
			result.push(parent);
		} else {
			for (const child of this._children) {
				if (child.kind === PromptNodeType.Text) {
					throw new Error(`Cannot have a text node outside a ChatMessage. Text: "${child.text}"`);
				} else if (child.kind === PromptNodeType.LineBreak) {
					throw new Error(`Cannot have a line break node outside a ChatMessage!`);
				}
				child._materialize(result, resultChunks);
			}
		}
	}

	public collectLeafs(result: LeafPromptNode[]): void {
		if (this._obj instanceof BaseChatMessage) {
			throw new Error(`Cannot have a ChatMessage nested inside a ChatMessage!`);
		}
		// Add an implicit <br/> before the element
		result.push(new PromptLineBreak(this, false));
		for (const child of this._children) {
			child.collectLeafs(result);
		}
	}
}

interface Countable {
	text: string;
	isImplicitLinebreak?: boolean;
}

class MaterializedChatMessageTextChunk implements Countable {
	constructor(
		public readonly message: MaterializedChatMessage,
		public readonly text: string,
		private readonly priority: number | undefined,
		public readonly childIndex: number,
		public readonly isImplicitLinebreak = false
	) { }

	public static cmp(a: MaterializedChatMessageTextChunk, b: MaterializedChatMessageTextChunk): number {
		if (a.priority !== undefined && b.priority !== undefined && a.priority === b.priority) {
			// If the chunks share the same parent, break priority ties based on the order
			// that the chunks were declared in under its parent chat message
			if (a.message === b.message) {
				return a.childIndex - b.childIndex;
			}
			// Otherwise, prioritize chunks that were declared last
			return b.childIndex - a.childIndex;
		}

		if (a.priority !== undefined && b.priority !== undefined && a.priority !== b.priority) {
			return b.priority - a.priority;
		}

		return a.childIndex - b.childIndex;
	}

	public toChatMessage() {
		return {
			role: this.message.role,
			content: this.text,
			...(this.message.name ? { name: this.message.name } : {})
		};
	}
}

class MaterializedChatMessage implements Countable {
	constructor(
		public readonly role: ChatRole,
		public readonly name: string | undefined,
		private readonly priority: number | undefined,
		private readonly childIndex: number,
		private _chunks: MaterializedChatMessageTextChunk[]
	) { }

	public set chunks(chunks: MaterializedChatMessageTextChunk[]) {
		this._chunks = chunks.sort(MaterializedChatMessageTextChunk.cmp);
	}

	public get text(): string {
		return this._chunks.reduce((acc, c, i) => {
			if (i !== (this._chunks.length - 1) || !c.isImplicitLinebreak) {
				acc += c.text;
			}
			return acc;
		}, '');
	}

	public toChatMessage(): ChatMessage {
		return {
			role: this.role,
			content: this.text,
			...(this.name ? { name: this.name } : {})
		};
	}

	public static cmp(a: MaterializedChatMessage, b: MaterializedChatMessage): number {
		if (a.priority !== b.priority) {
			return (b.priority || 0) - (a.priority || 0);
		}
		return b.childIndex - a.childIndex;
	}
}

class PromptText {

	public readonly kind = PromptNodeType.Text;

	constructor(
		public readonly parent: PromptTreeElement,
		public readonly text: string,
		public readonly priority?: number
	) { }

	public collectLeafs(result: LeafPromptNode[]) {
		result.push(this);
	}

}

class PromptLineBreak {

	public readonly kind = PromptNodeType.LineBreak;

	constructor(
		public readonly parent: PromptTreeElement,
		public readonly isExplicit: boolean,
		public readonly priority?: number
	) { }

	public collectLeafs(result: LeafPromptNode[]) {
		result.push(this);
	}
}

function isFragmentCtor(template: PromptPiece): boolean {
	return (typeof template.ctor === 'function' && template.ctor.isFragment) ?? false;
}
