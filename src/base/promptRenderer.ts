/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from "vscode";
import { ChatMessage, ChatRole } from "./openai";
import { PromptElement } from "./promptElement";
import { BaseChatMessage, ChatMessagePromptElement, TextChunk, isChatMessagePromptElement } from "./promptElements";
import { PromptMetadata, PromptReference } from "./results";
import { ITokenizer } from "./tokenizer/tokenizer";
import { BasePromptElementProps, IChatEndpointInfo, PromptElementCtor, PromptPiece, PromptPieceChild, PromptSizing } from "./types";
import { coalesce } from "./util/arrays";
import { URI } from "./util/vs/common/uri";
import { ChatDocumentContext, ChatResponsePart } from "./vscodeTypes";

export interface RenderPromptResult {
	readonly messages: ChatMessage[];
	readonly tokenCount: number;
	readonly hasIgnoredFiles: boolean;
	/**
	 * The references that survived prioritization in the rendered {@link RenderPromptResult.messages messages}.
	 */
	readonly references: PromptReference[];

	/**
	 * The references attached to chat message chunks that did not survive prioritization.
	 */
	readonly omittedReferences: PromptReference[];
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
	private readonly _ignoredFiles: URI[] = [];
	private readonly _root = new PromptTreeElement(null, 0);
	private readonly _references: PromptReference[] = [];

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
		private readonly _tokenizer: ITokenizer
	) { }

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

	protected createElement(element: QueueItem<PromptElementCtor<P, any>, P>) {
		return new element.ctor(element.props);
	}

	private async _processPromptPieces(sizing: PromptSizingContext, pieces: QueueItem<PromptElementCtor<P, any>, P>[], progress?: Progress<ChatResponsePart>, token?: CancellationToken) {
		// Collect all prompt elements in the next flex group to render, grouping
		// by the flex order in which they're rendered.
		const promptElements = new Map<number, { element: QueueItem<PromptElementCtor<P, any>, P>; promptElementInstance: PromptElement<any, any> }[]>();
		for (const [i, element] of pieces.entries()) {
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
			const flexGroupValue = element.props.flexGrow ?? Infinity;
			let flexGroup = promptElements.get(flexGroupValue);
			if (!flexGroup) {
				flexGroup = [];
				promptElements.set(flexGroupValue, flexGroup);
			}

			flexGroup.push({ element, promptElementInstance: promptElement });
		}

		const flexGroups = [...promptElements.entries()].sort(([a], [b]) => b - a).map(([_, group]) => group);
		const setReserved = (groupIndex: number, reserved: boolean) => {
			const sign = reserved ? 1 : -1;
			for (let i = groupIndex + 1; i < flexGroups.length; i++) {
				for (const { element } of flexGroups[i]) {
					if (element.props.flexReserve) {
						sizing.consume(sign * element.props.flexReserve);
					}
				}
			}
		};

		// Prepare all currently known prompt elements in parallel
		for (const [groupIndex, promptElements] of flexGroups.entries()) {
			// Temporarily consume any reserved budget for later elements so that the sizing is calculated correctly here.
			setReserved(groupIndex, true);

			// Calculate the flex basis for dividing the budget amongst siblings in this group.
			let flexBasisSum = 0;
			for (const { element } of promptElements) {
				// todo@connor4312: remove `flex` after transition
				flexBasisSum += (element.props.flex || element.props.flexBasis) ?? 1;
			}

			// Finally calculate the final sizing for each element in this group.
			const elementSizings: PromptSizing[] = promptElements.map(e => {
				const proportion = (e.element.props.flexBasis ?? 1) / flexBasisSum;
				return {
					tokenBudget: Math.floor(sizing.remainingTokenBudget * proportion),
					endpoint: sizing.endpoint,
					countTokens: (text, cancellation) => this._tokenizer.tokenLength(text, cancellation)
				};
			});


			// Free the previously-reserved budget now that we calculated sizing
			setReserved(groupIndex, false);

			await Promise.all(promptElements.map(async ({ element, promptElementInstance }, i) => {
				const state = await promptElementInstance.prepare?.(elementSizings[i], progress, token)
				element.node.setState(state);
			}));

			const templates = await Promise.all(promptElements.map(async ({ element, promptElementInstance }, i) => {
				const elementSizing = elementSizings[i];
				return await promptElementInstance.render(element.node.getState(), elementSizing)
			}));

			// Render
			for (const [i, { element, promptElementInstance }] of promptElements.entries()) {
				const elementSizing = elementSizings[i];
				const template = templates[i];

				if (!template) {
					// it doesn't want to render anything
					continue;
				}

				const pieces = flattenAndReduce(template);

				// Compute token budget for the pieces that this child wants to render
				const childSizing = new PromptSizingContext(elementSizing.tokenBudget, this._endpoint);
				const { tokensConsumed } = await computeTokensConsumedByLiterals(this._tokenizer, element, promptElementInstance, pieces);
				childSizing.consume(tokensConsumed);
				await this._handlePromptChildren(element, pieces, childSizing, progress, token);

				// Tally up the child consumption into the parent context for any subsequent flex group
				sizing.consume(childSizing.consumed);
			}
		}
	}

	private async _prioritize<T extends Countable>(things: T[], cmp: (a: T, b: T) => number, count: (thing: T) => Promise<number>) {
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

		let remainingBudget = this._endpoint.modelMaxPromptTokens;
		const omittedChunks: T[] = [];
		while (prioritizedChunks.length > 0) {
			const prioritizedChunk = prioritizedChunks.shift()!;
			const index = prioritizedChunk.index;
			const chunk = things[index];
			let tokenCount = await count(chunk);
			let precedingLinebreak;
			if (prioritizedChunk.precedingLinebreak) {
				precedingLinebreak = things[prioritizedChunk.precedingLinebreak];
				tokenCount += await count(precedingLinebreak);
			}
			if (tokenCount > remainingBudget) {
				// Wouldn't fit anymore
				omittedChunks.push(chunk);
				break;
			}
			chunkResult[index] = chunk;
			if (prioritizedChunk.precedingLinebreak && precedingLinebreak) {
				chunkResult[prioritizedChunk.precedingLinebreak] = precedingLinebreak;
			}
			remainingBudget -= tokenCount;
		}

		for (const omittedChunk of prioritizedChunks) {
			const index = omittedChunk.index;
			const chunk = things[index];
			omittedChunks.push(chunk);
		}

		return { result: coalesce(chunkResult), tokenCount: this._endpoint.modelMaxPromptTokens - remainingBudget, omittedChunks };
	}

	/**
	 * Renders the prompt element and its children.
	 * @returns A promise that resolves to an object containing the rendered chat messages and the total token count.
	 * The total token count is guaranteed to be less than or equal to the token budget.
	 */
	public async render(progress?: Progress<ChatResponsePart>, token?: CancellationToken): Promise<RenderPromptResult> {
		// Convert root prompt element to prompt pieces
		await this._processPromptPieces(
			new PromptSizingContext(this._endpoint.modelMaxPromptTokens, this._endpoint),
			[{ node: this._root, ctor: this._ctor, props: this._props, children: [] }],
			progress,
			token,
		);

		// Convert prompt pieces to message chunks (text and linebreaks)
		const { result: messageChunks, resultChunks } = this._root.materialize();

		// First pass: sort message chunks by priority. Note that this can yield an imprecise result due to token boundaries within a single chat message
		// so we also need to do a second pass over the full chat messages later
		const chunkMessages = new Set<MaterializedChatMessage>();
		const { result: prioritizedChunks, omittedChunks } = await this._prioritize(
			resultChunks,
			(a, b) => MaterializedChatMessageTextChunk.cmp(a, b),
			async (chunk) => {
				let tokenLength = await this._tokenizer.tokenLength(chunk.text);
				if (!chunkMessages.has(chunk.message)) {
					chunkMessages.add(chunk.message);
					tokenLength = await this._tokenizer.countMessageTokens(chunk.toChatMessage());
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
		for (const message of messageChunks) {
			const chunks = chatMessagesToChunks.get(message);
			if (chunks) {
				message.chunks = coalesce(chunks);
				for (const chunk of chunks) {
					if (chunk && chunk.references.length > 0) {
						message.references.push(...chunk.references);
					}
				}
				chatMessages.push(message);
			}
		}

		// Second pass: make sure the chat messages will fit within the token budget
		const { result: prioritizedMaterializedChatMessages, tokenCount } = await this._prioritize(chatMessages, (a, b) => MaterializedChatMessage.cmp(a, b), async (message) => this._tokenizer.countMessageTokens(message.toChatMessage()));

		// Then finalize the chat messages
		const messageResult = prioritizedMaterializedChatMessages.map(message => message?.toChatMessage());

		// Remove undefined and duplicate references
		const { references, names } = prioritizedMaterializedChatMessages.reduce<{ references: PromptReference[], names: Set<string> }>((acc, message) => {
			[...this._references, ...message.references].forEach((ref) => {
				const isVariableName = 'variableName' in ref.anchor;
				if (isVariableName && !acc.names.has(ref.anchor.variableName)) {
					acc.references.push(ref);
					acc.names.add(ref.anchor.variableName);
				} else if (!isVariableName) {
					acc.references.push(ref);
				}
			});
			return acc;
		}, { references: [], names: new Set<string>() });

		// Collect the references for chat message chunks that did not survive prioritization
		const { references: omittedReferences } = omittedChunks.reduce<{ references: PromptReference[] }>((acc, message) => {
			message.references.forEach((ref) => {
				const isVariableName = 'variableName' in ref.anchor;
				if (isVariableName && !names.has(ref.anchor.variableName)) {
					acc.references.push(ref);
					names.add(ref.anchor.variableName);
				} else if (!isVariableName) {
					acc.references.push(ref);
				}
			});
			return acc;
		}, { references: [] });

		return { messages: messageResult, hasIgnoredFiles: this._ignoredFiles.length > 0, tokenCount, references: coalesce(references), omittedReferences: coalesce(omittedReferences) };
	}

	private _handlePromptChildren(element: QueueItem<PromptElementCtor<any, any>, P>, pieces: ProcessedPromptPiece[], sizing: PromptSizingContext, progress: Progress<ChatResponsePart> | undefined, token: CancellationToken | undefined) {
		if (element.ctor === TextChunk) {
			this._handleExtrinsicTextChunkChildren(element.node.parent!, element.node, element.props, pieces);
			return;
		}

		let todo: QueueItem<PromptElementCtor<P, any>, P>[] = [];
		for (const piece of pieces) {
			if (piece.kind === 'literal') {
				element.node.appendStringChild(piece.value, element.props.priority ?? Number.MAX_SAFE_INTEGER);
				continue;
			}
			if (piece.kind === 'intrinsic') {
				// intrinsic element
				this._handleIntrinsic(element.node, piece.name, { priority: element.props.priority ?? Number.MAX_SAFE_INTEGER, ...piece.props }, flattenAndReduceArr(piece.children));
				continue;
			}

			const childNode = element.node.createChild();
			todo.push({ node: childNode, ctor: piece.ctor, props: { priority: element.props.priority, ...piece.props }, children: piece.children });
		}

		return this._processPromptPieces(sizing, todo, progress, token);
	}

	private _handleIntrinsic(node: PromptTreeElement, name: string, props: any, children: ProcessedPromptPiece[], sortIndex?: number): void {
		switch (name) {
			case 'meta':
				return this._handleIntrinsicMeta(node, props, children);
			case 'br':
				return this._handleIntrinsicLineBreak(node, props, children, props.priority, sortIndex);
			case 'usedContext':
				return this._handleIntrinsicUsedContext(node, props, children);
			case 'references':
				return this._handleIntrinsicReferences(node, props, children);
			case 'ignoredFiles':
				return this._handleIntrinsicIgnoredFiles(node, props, children);
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

	private _handleIntrinsicLineBreak(node: PromptTreeElement, props: JSX.IntrinsicElements['br'], children: ProcessedPromptPiece[], inheritedPriority?: number, sortIndex?: number) {
		if (children.length > 0) {
			throw new Error(`<br /> must not have children!`);
		}
		node.appendLineBreak(true, inheritedPriority ?? Number.MAX_SAFE_INTEGER, sortIndex);
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
		node.addReferences(props.value);
		this._references.push(...props.value);
	}


	private _handleIntrinsicIgnoredFiles(node: PromptTreeElement, props: JSX.IntrinsicElements['ignoredFiles'], children: ProcessedPromptPiece[]) {
		if (children.length > 0) {
			throw new Error(`<ignoredFiles /> must not have children!`);
		}
		this._ignoredFiles.push(...props.value);
	}

	/**
	 * @param node Parent of the <TextChunk />
	 * @param textChunkNode The <TextChunk /> node. All children are in-order
	 * appended to the parent using the same sort index to ensure order is preserved.
	 * @param props Props of the <TextChunk />
	 * @param children Rendered children of the <TextChunk />
	 */
	private _handleExtrinsicTextChunkChildren(node: PromptTreeElement, textChunkNode: PromptTreeElement, props: BasePromptElementProps, children: ProcessedPromptPiece[]) {
		const content: string[] = [];
		const references: PromptReference[] = [];

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
				} else if (child.name === 'references') {
					// For TextChunks, references must be propagated through the PromptText element that is appended to the node
					references.push(...child.props.value);
				} else {
					this._handleIntrinsic(node, child.name, child.props, flattenAndReduceArr(child.children), textChunkNode.childIndex);
				}
			}
		}

		node.appendLineBreak(false, undefined, textChunkNode.childIndex);
		node.appendStringChild(content.join(''), props?.priority ?? Number.MAX_SAFE_INTEGER, references, textChunkNode.childIndex);
	}
}

async function computeTokensConsumedByLiterals(tokenizer: ITokenizer, element: QueueItem<PromptElementCtor<any, any>, any>
	, instance: PromptElement<any, any>, pieces: ProcessedPromptPiece[]) {
	let tokensConsumed = 0;

	if (isChatMessagePromptElement(instance)) {
		tokensConsumed += await tokenizer.countMessageTokens({ role: element.props.role, content: '', ...(element.props.name ? { name: element.props.name } : undefined) });

		for (const piece of pieces) {
			if (piece.kind === 'literal') {
				tokensConsumed += await tokenizer.tokenLength(piece.value);
			}
		}
	}

	return { tokensConsumed };
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

/**
 * A shared instance given to each PromptTreeElement that contains information
 * about the parent sizing and its children.
 */
class PromptSizingContext {
	private _consumed = 0;

	constructor(
		public readonly tokenBudget: number,
		public readonly endpoint: IChatEndpointInfo,
	) { }

	public get consumed() {
		return this._consumed > this.tokenBudget ? this.tokenBudget : this._consumed;
	}

	public get remainingTokenBudget() {
		return Math.max(0, this.tokenBudget - this._consumed);
	}

	/** Marks part of the budget as having been consumed by a render() call. */
	public consume(budget: number) {
		this._consumed += budget;
	}
}

class PromptTreeElement {

	public readonly kind = PromptNodeType.Piece;

	private _obj: PromptElement | null = null;
	private _state: any | undefined = undefined;
	private _children: PromptNode[] = [];
	private _references: PromptReference[] = [];

	constructor(
		public readonly parent: PromptTreeElement | null = null,
		public readonly childIndex: number,
	) { }

	public setObj(obj: PromptElement) {
		this._obj = obj;
	}

	public setState(state: any) {
		this._state = state;
	}

	public getState(): any {
		return this._state;
	}

	public createChild(): PromptTreeElement {
		const child = new PromptTreeElement(this, this._children.length);
		this._children.push(child);
		return child;
	}

	public appendStringChild(text: string, priority?: number, references?: PromptReference[], sortIndex = this._children.length) {
		this._children.push(new PromptText(this, sortIndex, text, priority, references));
	}

	public appendLineBreak(explicit = true, priority?: number, sortIndex = this._children.length): void {
		this._children.push(new PromptLineBreak(this, sortIndex, explicit, priority));
	}

	public materialize(): { result: MaterializedChatMessage[]; resultChunks: MaterializedChatMessageTextChunk[] } {
		const result: MaterializedChatMessage[] = [];
		const resultChunks: MaterializedChatMessageTextChunk[] = [];
		this._materialize(result, resultChunks);
		return { result, resultChunks };
	}

	private _materialize(result: MaterializedChatMessage[], resultChunks: MaterializedChatMessageTextChunk[]): void {
		this._children.sort((a, b) => a.childIndex - b.childIndex);
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
					chunks.push(new MaterializedChatMessageTextChunk(parent, node.text, node.priority, childIndex++, false, node.references ?? this._references));
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
		if (this._obj?.insertLineBreakBefore) {
			// Add an implicit <br/> before the element
			result.push(new PromptLineBreak(this, 0, false));
		}
		for (const child of this._children) {
			child.collectLeafs(result);
		}
	}

	public addReferences(references: PromptReference[]): void {
		this._references.push(...references);
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
		public readonly isImplicitLinebreak = false,
		public readonly references: PromptReference[] = []
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
		private _chunks: MaterializedChatMessageTextChunk[],
		public references: PromptReference[] = []
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
		public readonly childIndex: number,
		public readonly text: string,
		public readonly priority?: number,
		public readonly references?: PromptReference[]
	) { }

	public collectLeafs(result: LeafPromptNode[]) {
		result.push(this);
	}

}

class PromptLineBreak {

	public readonly kind = PromptNodeType.LineBreak;

	constructor(
		public readonly parent: PromptTreeElement,
		public readonly childIndex: number,
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
