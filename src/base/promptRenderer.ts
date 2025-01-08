/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from 'vscode';
import * as JSONT from './jsonTypes';
import { PromptNodeType } from './jsonTypes';
import {
	ContainerFlags,
	LineBreakBefore,
	MaterializedChatMesageImage,
	MaterializedChatMessage,
	MaterializedChatMessageTextChunk,
	MaterializedContainer,
} from './materialized';
import { ChatMessage, ChatRole } from './openai';
import { PromptElement } from './promptElement';
import {
	AssistantMessage,
	BaseChatMessage,
	ChatMessagePromptElement,
	Chunk,
	Expandable,
	isChatMessagePromptElement,
	LegacyPrioritization,
	TextChunk,
	TokenLimit,
	TokenLimitProps,
	ToolMessage,
	ImageProps,
	BaseImageMessage,
} from './promptElements';
import { PromptMetadata, PromptReference } from './results';
import { ITokenizer } from './tokenizer/tokenizer';
import { ITracer } from './tracer';
import {
	BasePromptElementProps,
	IChatEndpointInfo,
	PromptElementCtor,
	PromptPiece,
	PromptPieceChild,
	PromptSizing,
} from './types';
import { URI } from './util/vs/common/uri';
import { ChatDocumentContext, ChatResponsePart } from './vscodeTypes';

export interface RenderPromptResult {
	readonly messages: ChatMessage[];
	readonly tokenCount: number;
	readonly hasIgnoredFiles: boolean;
	readonly metadata: MetadataMap;
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
	getAll<T extends PromptMetadata>(key: new (...args: any[]) => T): T[];
}

export namespace MetadataMap {
	export const empty: MetadataMap = {
		get: () => undefined,
		getAll: () => [],
	};
}

/**
 * A prompt renderer is responsible for rendering a {@link PromptElementCtor prompt element} to {@link ChatMessagePromptElement chat messages}.
 *
 * Note: You must create a fresh prompt renderer instance for each prompt element you want to render.
 */
export class PromptRenderer<P extends BasePromptElementProps> {
	private readonly _usedContext: ChatDocumentContext[] = [];
	private readonly _ignoredFiles: URI[] = [];
	private readonly _growables: { initialConsume: number; elem: PromptTreeElement }[] = [];
	private readonly _root = new PromptTreeElement(null, 0);
	private readonly _tokenLimits: { limit: number; id: number }[] = [];
	/** Epoch used to tracing the order in which elements render. */
	public tracer: ITracer | undefined = undefined;

	/**
	 * @param _endpoint The chat endpoint that the rendered prompt will be sent to.
	 * @param _ctor The prompt element constructor to render.
	 * @param _props The props to pass to the prompt element.
	 */
	constructor(
		private readonly _endpoint: IChatEndpointInfo,
		private readonly _ctor: PromptElementCtor<P, any>,
		private readonly _props: P,
		private readonly _tokenizer: ITokenizer
	) {}

	public getIgnoredFiles(): URI[] {
		return Array.from(new Set(this._ignoredFiles));
	}

	public getUsedContext(): ChatDocumentContext[] {
		return this._usedContext;
	}

	protected createElement(element: QueueItem<PromptElementCtor<P, any>, P>) {
		return new element.ctor(element.props);
	}

	private async _processPromptPieces(
		sizing: PromptSizingContext,
		pieces: QueueItem<PromptElementCtor<P, any>, P>[],
		progress?: Progress<ChatResponsePart>,
		token?: CancellationToken
	) {
		// Collect all prompt elements in the next flex group to render, grouping
		// by the flex order in which they're rendered.
		const promptElements = new Map<
			number,
			{
				element: QueueItem<PromptElementCtor<P, any>, P>;
				promptElementInstance: PromptElement<any, any>;
				tokenLimit: number | undefined;
			}[]
		>();
		for (const [i, element] of pieces.entries()) {
			// Set any jsx children as the props.children
			if (Array.isArray(element.children)) {
				element.props = element.props ?? {};
				(element.props as any).children = element.children; // todo@joyceerhl clean up any
			}

			// Instantiate the prompt part
			if (!element.ctor) {
				throw new Error(
					`Invalid ChatMessage child! Child must be a TSX component that extends PromptElement.`
				);
			}

			const promptElement = this.createElement(element);
			let tokenLimit: number | undefined;
			if (promptElement instanceof TokenLimit) {
				tokenLimit = (element.props as unknown as TokenLimitProps).max;
				this._tokenLimits.push({ limit: tokenLimit, id: element.node.id });
			}
			element.node.setObj(promptElement);

			// Prepare rendering
			const flexGroupValue = element.props.flexGrow ?? Infinity;
			let flexGroup = promptElements.get(flexGroupValue);
			if (!flexGroup) {
				flexGroup = [];
				promptElements.set(flexGroupValue, flexGroup);
			}

			flexGroup.push({ element, promptElementInstance: promptElement, tokenLimit });
		}

		if (promptElements.size === 0) {
			return;
		}

		const flexGroups = [...promptElements.entries()]
			.sort(([a], [b]) => b - a)
			.map(([_, group]) => group);
		const setReserved = (groupIndex: number) => {
			let reservedTokens = 0;
			for (let i = groupIndex + 1; i < flexGroups.length; i++) {
				for (const { element } of flexGroups[i]) {
					if (!element.props.flexReserve) {
						continue;
					}
					const reserve =
						typeof element.props.flexReserve === 'string'
							? // Typings ensure the string is `/${number}`
							Math.floor(sizing.remainingTokenBudget / Number(element.props.flexReserve.slice(1)))
							: element.props.flexReserve;
					reservedTokens += reserve;
				}
			}

			sizing.consume(reservedTokens);
			return reservedTokens;
		};

		// Prepare all currently known prompt elements in parallel
		for (const [groupIndex, promptElements] of flexGroups.entries()) {
			// Temporarily consume any reserved budget for later elements so that the sizing is calculated correctly here.
			const reservedTokens = setReserved(groupIndex);

			// Calculate the flex basis for dividing the budget amongst siblings in this group.
			let flexBasisSum = 0;
			for (const { element } of promptElements) {
				flexBasisSum += element.props.flexBasis ?? 1;
			}

			let constantTokenLimits = 0;
			//.For elements that limit their token usage and would use less than we
			// otherwise would assign to them, 'cap' their usage at the limit and
			// remove their share directly from the budget in distribution.
			const useConstantLimitsForIndex = promptElements.map(e => {
				if (e.tokenLimit === undefined) {
					return false;
				}

				const flexBasis = e.element.props.flexBasis ?? 1;
				const proportion = flexBasis / flexBasisSum;
				const proportionateUsage = Math.floor(sizing.remainingTokenBudget * proportion);
				if (proportionateUsage < e.tokenLimit) {
					return false;
				}

				flexBasisSum -= flexBasis;
				constantTokenLimits += e.tokenLimit;
				return true;
			});

			// Finally calculate the final sizing for each element in this group.
			const elementSizings: PromptSizing[] = promptElements.map((e, i) => {
				const proportion = (e.element.props.flexBasis ?? 1) / flexBasisSum;
				return {
					tokenBudget: useConstantLimitsForIndex[i]
						? e.tokenLimit!
						: Math.floor((sizing.remainingTokenBudget - constantTokenLimits) * proportion),
					endpoint: sizing.endpoint,
					countTokens: (text, cancellation) => this._tokenizer.tokenLength(text, cancellation),
				};
			});

			// Free the previously-reserved budget now that we calculated sizing
			sizing.consume(-reservedTokens);

			this.tracer?.addRenderEpoch?.({
				inNode: promptElements[0].element.node.parent?.id,
				flexValue: promptElements[0].element.props.flexGrow ?? 0,
				tokenBudget: sizing.remainingTokenBudget,
				reservedTokens,
				elements: promptElements.map((e, i) => ({
					id: e.element.node.id,
					tokenBudget: elementSizings[i].tokenBudget,
				})),
			});

			await Promise.all(
				promptElements.map(async ({ element, promptElementInstance }, i) => {
					const state = await promptElementInstance.prepare?.(elementSizings[i], progress, token);
					element.node.setState(state);
				})
			);

			const templates = await Promise.all(
				promptElements.map(async ({ element, promptElementInstance }, i) => {
					const elementSizing = elementSizings[i];
					return await promptElementInstance.render(
						element.node.getState(),
						elementSizing,
						progress,
						token
					);
				})
			);

			// Render
			for (const [i, { element, promptElementInstance }] of promptElements.entries()) {
				const elementSizing = elementSizings[i];
				const template = templates[i];

				if (!template) {
					// it doesn't want to render anything
					continue;
				}

				const childConsumption = await this._processPromptRenderPiece(
					new PromptSizingContext(elementSizing.tokenBudget, this._endpoint),
					element,
					promptElementInstance,
					template,
					progress,
					token
				);

				// Append growables here so that when we go back and expand them we do so in render order.
				if (promptElementInstance instanceof Expandable) {
					this._growables.push({ initialConsume: childConsumption, elem: element.node });
				}

				// Tally up the child consumption into the parent context for any subsequent flex group
				sizing.consume(childConsumption);
			}
		}
	}

	private async _processPromptRenderPiece(
		elementSizing: PromptSizingContext,
		element: QueueItem<PromptElementCtor<any, any>, any>,
		promptElementInstance: PromptElement<any, any>,
		template: PromptPiece,
		progress: Progress<ChatResponsePart> | undefined,
		token: CancellationToken | undefined
	) {
		const pieces = flattenAndReduce(template);

		// Compute token budget for the pieces that this child wants to render
		const childSizing = new PromptSizingContext(elementSizing.tokenBudget, this._endpoint);
		const { tokensConsumed } = await computeTokensConsumedByLiterals(
			this._tokenizer,
			element,
			promptElementInstance,
			pieces
		);
		childSizing.consume(tokensConsumed);
		await this._handlePromptChildren(element, pieces, childSizing, progress, token);

		// Tally up the child consumption into the parent context for any subsequent flex group
		return childSizing.consumed;
	}

	/**
	 * Renders the prompt element and its children to a JSON-serializable state.
	 * @returns A promise that resolves to an object containing the rendered chat messages and the total token count.
	 * The total token count is guaranteed to be less than or equal to the token budget.
	 */
	public async renderElementJSON(token?: CancellationToken): Promise<JSONT.PromptElementJSON> {
		await this._processPromptPieces(
			new PromptSizingContext(this._endpoint.modelMaxPromptTokens, this._endpoint),
			[{ node: this._root, ctor: this._ctor, props: this._props, children: [] }],
			undefined,
			token
		);

		// todo@connor4312: should ignored files, used context, etc. be passed here?
		return {
			node: this._root.toJSON(),
		};
	}

	/**
	 * Renders the prompt element and its children.
	 * @returns A promise that resolves to an object containing the rendered chat messages and the total token count.
	 * The total token count is guaranteed to be less than or equal to the token budget.
	 */
	public async render(
		progress?: Progress<ChatResponsePart>,
		token?: CancellationToken
	): Promise<RenderPromptResult> {
		// Convert root prompt element to prompt pieces
		await this._processPromptPieces(
			new PromptSizingContext(this._endpoint.modelMaxPromptTokens, this._endpoint),
			[{ node: this._root, ctor: this._ctor, props: this._props, children: [] }],
			progress,
			token
		);

		const { container, allMetadata, removed } = await this._getFinalElementTree(
			this._endpoint.modelMaxPromptTokens,
			token
		);
		this.tracer?.didMaterializeTree?.({
			budget: this._endpoint.modelMaxPromptTokens,
			renderedTree: { container, removed, budget: this._endpoint.modelMaxPromptTokens },
			tokenizer: this._tokenizer,
			renderTree: budget =>
				this._getFinalElementTree(budget, undefined).then(r => ({ ...r, budget })),
		});

		// Then finalize the chat messages
		const messageResult = [...container.toChatMessages()];
		const tokenCount = await container.tokenCount(this._tokenizer);
		const remainingMetadata = [...container.allMetadata()];

		// Remove undefined and duplicate references
		const referenceNames = new Set<string>();
		const references = remainingMetadata
			.map(m => {
				if (!(m instanceof ReferenceMetadata)) {
					return;
				}

				const ref = m.reference;
				const isVariableName = 'variableName' in ref.anchor;
				if (isVariableName && !referenceNames.has(ref.anchor.variableName)) {
					referenceNames.add(ref.anchor.variableName);
					return ref;
				} else if (!isVariableName) {
					return ref;
				}
			})
			.filter(isDefined);

		// Collect the references for chat message chunks that did not survive prioritization
		const omittedReferences = allMetadata
			.map(m => {
				if (!(m instanceof ReferenceMetadata) || remainingMetadata.includes(m)) {
					return;
				}

				const ref = m.reference;
				const isVariableName = 'variableName' in ref.anchor;
				if (isVariableName && !referenceNames.has(ref.anchor.variableName)) {
					referenceNames.add(ref.anchor.variableName);
					return ref;
				} else if (!isVariableName) {
					return ref;
				}
			})
			.filter(isDefined);

		return {
			metadata: {
				get: ctor => remainingMetadata.find(m => m instanceof ctor) as any,
				getAll: ctor => remainingMetadata.filter(m => m instanceof ctor) as any,
			},
			messages: messageResult,
			hasIgnoredFiles: this._ignoredFiles.length > 0,
			tokenCount,
			references,
			omittedReferences,
		};
	}

	/**
	 * Note: this may be called multiple times from the tracer as users play
	 * around with budgets. It should be side-effect-free.
	 */
	private async _getFinalElementTree(tokenBudget: number, token: CancellationToken | undefined) {
		const root = this._root.materialize() as MaterializedContainer;
		const allMetadata = [...root.allMetadata()];
		const limits = [{ limit: tokenBudget, id: this._root.id }, ...this._tokenLimits];
		let removed = 0;

		for (let i = limits.length - 1; i >= 0; i--) {
			const limit = limits[i];
			if (limit.limit > tokenBudget) {
				continue;
			}

			const container = root.findById(limit.id);
			if (!container) {
				continue;
			}

			const initialTokenCount = await container.tokenCount(this._tokenizer);
			if (initialTokenCount < limit.limit) {
				const didChange = await this._grow(container, initialTokenCount, limit.limit, token);

				// if nothing grew, we already counted tokens so we can safely return
				if (!didChange) {
					continue;
				}
			}

			// Trim the elements to fit within the token budget. We check the "lower bound"
			// first because that's much more cache-friendly as we remove elements.
			while (
				(await container.upperBoundTokenCount(this._tokenizer)) > limit.limit &&
				(await container.tokenCount(this._tokenizer)) > limit.limit
			) {
				container.removeLowestPriorityChild();
				removed++;
			}
		}

		return { container: root, allMetadata, removed };
	}

	/** Grows all Expandable elements, returns if any changes were made. */
	private async _grow(
		tree: MaterializedContainer | MaterializedChatMessage | MaterializedChatMesageImage,
		tokensUsed: number,
		tokenBudget: number,
		token: CancellationToken | undefined
	): Promise<boolean> {
		if (!this._growables.length) {
			return false;
		}

		for (const growable of this._growables) {
			if (!tree.findById(growable.elem.id)) {
				continue; // not in this subtree
			}

			const obj = growable.elem.getObj();
			if (!(obj instanceof Expandable)) {
				throw new Error('unreachable: expected growable');
			}

			const tempRoot = new PromptTreeElement(null, 0, growable.elem.id);
			// Sizing for the grow is the remaining excess plus the initial consumption,
			// since the element consuming the initial amount of tokens will be replaced
			const sizing = new PromptSizingContext(
				tokenBudget - tokensUsed + growable.initialConsume,
				this._endpoint
			);

			const newConsumed = await this._processPromptRenderPiece(
				sizing,
				{ node: tempRoot, ctor: this._ctor, props: {}, children: [] },
				obj,
				await obj.render(undefined, {
					tokenBudget: sizing.tokenBudget,
					endpoint: this._endpoint,
					countTokens: (text, cancellation) => this._tokenizer.tokenLength(text, cancellation),
				}),
				undefined,
				token
			);

			const newContainer = tempRoot.materialize() as MaterializedContainer;
			const oldContainer = tree.replaceNode(growable.elem.id, newContainer);
			if (!oldContainer) {
				throw new Error('unreachable: could not find old element to replace');
			}

			tokensUsed -= growable.initialConsume;
			tokensUsed += newConsumed;
			if (tokensUsed >= tokenBudget) {
				break;
			}
		}

		return true;
	}

	private _handlePromptChildren(
		element: QueueItem<PromptElementCtor<any, any>, P>,
		pieces: ProcessedPromptPiece[],
		sizing: PromptSizingContext,
		progress: Progress<ChatResponsePart> | undefined,
		token: CancellationToken | undefined
	) {
		if (element.ctor === TextChunk || element.ctor === BaseImageMessage) {
			this._handleExtrinsicTextChunkChildren(element.node, element.node, element.props, pieces);
			return;
		}

		let todo: QueueItem<PromptElementCtor<P, any>, P>[] = [];
		for (const piece of pieces) {
			if (piece.kind === 'literal') {
				element.node.appendStringChild(
					piece.value,
					element.props.priority ?? Number.MAX_SAFE_INTEGER
				);
				continue;
			}
			if (piece.kind === 'intrinsic') {
				// intrinsic element
				this._handleIntrinsic(
					element.node,
					piece.name,
					{
						priority: element.props.priority ?? Number.MAX_SAFE_INTEGER,
						...piece.props,
					},
					flattenAndReduceArr(piece.children)
				);
				continue;
			}

			const childNode = element.node.createChild();
			todo.push({
				node: childNode,
				ctor: piece.ctor,
				props: { priority: element.props.priority, ...piece.props },
				children: piece.children,
			});
		}

		return this._processPromptPieces(sizing, todo, progress, token);
	}

	private _handleIntrinsic(
		node: PromptTreeElement,
		name: string,
		props: any,
		children: ProcessedPromptPiece[],
		sortIndex?: number
	): void {
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
			case 'elementJSON':
				return this._handleIntrinsicElementJSON(node, props.data);
		}
		throw new Error(`Unknown intrinsic element ${name}!`);
	}

	private _handleIntrinsicMeta(
		node: PromptTreeElement,
		props: JSX.IntrinsicElements['meta'],
		children: ProcessedPromptPiece[]
	) {
		if (children.length > 0) {
			throw new Error(`<meta /> must not have children!`);
		}

		if (props.local) {
			node.addMetadata(props.value);
		} else {
			this._root.addMetadata(props.value);
		}
	}

	private _handleIntrinsicLineBreak(
		node: PromptTreeElement,
		props: JSX.IntrinsicElements['br'],
		children: ProcessedPromptPiece[],
		inheritedPriority?: number,
		sortIndex?: number
	) {
		if (children.length > 0) {
			throw new Error(`<br /> must not have children!`);
		}
		node.appendLineBreak(inheritedPriority ?? Number.MAX_SAFE_INTEGER, sortIndex);
	}

	private _handleIntrinsicElementJSON(node: PromptTreeElement, data: JSONT.PromptElementJSON) {
		const appended = node.appendPieceJSON(data.node);
		if (this.tracer?.includeInEpoch) {
			for (const child of appended.elements()) {
				// tokenBudget is just 0 because we don't know the renderer state on the tool side.
				this.tracer.includeInEpoch({ id: child.id, tokenBudget: 0 });
			}
		}
	}

	private _handleIntrinsicUsedContext(
		node: PromptTreeElement,
		props: JSX.IntrinsicElements['usedContext'],
		children: ProcessedPromptPiece[]
	) {
		if (children.length > 0) {
			throw new Error(`<usedContext /> must not have children!`);
		}
		this._usedContext.push(...props.value);
	}

	private _handleIntrinsicReferences(
		node: PromptTreeElement,
		props: JSX.IntrinsicElements['references'],
		children: ProcessedPromptPiece[]
	) {
		if (children.length > 0) {
			throw new Error(`<reference /> must not have children!`);
		}
		for (const ref of props.value) {
			node.addMetadata(new ReferenceMetadata(ref));
		}
	}

	private _handleIntrinsicIgnoredFiles(
		node: PromptTreeElement,
		props: JSX.IntrinsicElements['ignoredFiles'],
		children: ProcessedPromptPiece[]
	) {
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
	private _handleExtrinsicTextChunkChildren(
		node: PromptTreeElement,
		textChunkNode: PromptTreeElement,
		props: BasePromptElementProps,
		children: ProcessedPromptPiece[]
	) {
		const content: string[] = [];
		const metadata: PromptMetadata[] = [];

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
					for (const reference of child.props.value) {
						metadata.push(new ReferenceMetadata(reference));
					}
				} else {
					this._handleIntrinsic(
						node,
						child.name,
						child.props,
						flattenAndReduceArr(child.children),
						textChunkNode.childIndex
					);
				}
			}
		}

		node.appendStringChild(
			content.join(''),
			props?.priority ?? Number.MAX_SAFE_INTEGER,
			metadata,
			textChunkNode.childIndex,
			true
		);
	}
}

async function computeTokensConsumedByLiterals(
	tokenizer: ITokenizer,
	element: QueueItem<PromptElementCtor<any, any>, any>,
	instance: PromptElement<any, any>,
	pieces: ProcessedPromptPiece[]
) {
	let tokensConsumed = 0;

	if (isChatMessagePromptElement(instance)) {
		tokensConsumed += await tokenizer.countMessageTokens({
			role: element.props.role,
			content: '',
			...(element.props.name ? { name: element.props.name } : undefined),
		});
	}

	for (const piece of pieces) {
		if (piece.kind === 'literal') {
			tokensConsumed += await tokenizer.tokenLength(piece.value);
		}
	}

	return { tokensConsumed };
}

// Flatten nested fragments and normalize children
function flattenAndReduce(
	c: string | number | PromptPiece<any> | undefined,
	into: ProcessedPromptPiece[] = []
): ProcessedPromptPiece[] {
	if (typeof c === 'undefined' || typeof c === 'boolean') {
		// booleans are ignored to allow for the pattern: { cond && <Element ... /> }
		return [];
	} else if (typeof c === 'string' || typeof c === 'number') {
		into.push(new LiteralPromptPiece(String(c)));
	} else if (isFragmentCtor(c)) {
		flattenAndReduceArr(c.children, into);
	} else if (isIterable(c)) {
		flattenAndReduceArr(c, into);
	} else if (typeof c.ctor === 'string') {
		// intrinsic element
		into.push(new IntrinsicPromptPiece(c.ctor, c.props, c.children));
	} else {
		// extrinsic element
		into.push(new ExtrinsicPromptPiece(c.ctor, c.props, c.children));
	}

	return into;
}

function flattenAndReduceArr(
	arr: Iterable<PromptPieceChild>,
	into: ProcessedPromptPiece[] = []
): ProcessedPromptPiece[] {
	for (const entry of arr) {
		flattenAndReduce(entry, into);
	}
	return into;
}

class IntrinsicPromptPiece<K extends keyof JSX.IntrinsicElements> {
	public readonly kind = 'intrinsic';

	constructor(
		public readonly name: string,
		public readonly props: JSX.IntrinsicElements[K],
		public readonly children: PromptPieceChild[]
	) {}
}

class ExtrinsicPromptPiece<P extends BasePromptElementProps = any, S = any> {
	public readonly kind = 'extrinsic';

	constructor(
		public readonly ctor: PromptElementCtor<P, S>,
		public readonly props: P,
		public readonly children: PromptPieceChild[]
	) {}
}

class LiteralPromptPiece {
	public readonly kind = 'literal';

	constructor(public readonly value: string, public readonly priority?: number) {}
}

type ProcessedPromptPiece =
	| LiteralPromptPiece
	| IntrinsicPromptPiece<any>
	| ExtrinsicPromptPiece<any, any>;

type PromptNode = PromptTreeElement | PromptText;
type LeafPromptNode = PromptText;

/**
 * A shared instance given to each PromptTreeElement that contains information
 * about the parent sizing and its children.
 */
class PromptSizingContext {
	private _consumed = 0;

	constructor(public readonly tokenBudget: number, public readonly endpoint: IChatEndpointInfo) {}

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
	private static _nextId = 0;

	public static fromJSON(index: number, json: JSONT.PieceJSON): PromptTreeElement {
		const element = new PromptTreeElement(null, index);
		element._metadata =
			json.references?.map(r => new ReferenceMetadata(PromptReference.fromJSON(r))) ?? [];
		element._children = json.children
			.map((childJson, i) => {
				switch (childJson.type) {
					case JSONT.PromptNodeType.Piece:
						return PromptTreeElement.fromJSON(i, childJson);
					case JSONT.PromptNodeType.Text:
						return PromptText.fromJSON(element, i, childJson);
					default:
						softAssertNever(childJson);
				}
			})
			.filter(isDefined);

		switch (json.ctor) {
			case JSONT.PieceCtorKind.BaseChatMessage:
				element._obj = new BaseChatMessage(json.props!);
				break;
			case JSONT.PieceCtorKind.Other:
				break; // no-op
			case JSONT.PieceCtorKind.ImageChatMessage:
				element._obj = new BaseImageMessage({ imageUrl: json.props!.imageUrl as string, detail: json.props!.detail as "low" | "high"});
				break;
			default:
				softAssertNever(json.ctor);
		}

		return element;
	}

	public readonly kind = PromptNodeType.Piece;

	private _obj: PromptElement | null = null;
	private _state: any | undefined = undefined;
	private _children: PromptNode[] = [];
	private _metadata: PromptMetadata[] = [];

	constructor(
		public readonly parent: PromptTreeElement | null = null,
		public readonly childIndex: number,
		public readonly id = PromptTreeElement._nextId++
	) {}

	public setObj(obj: PromptElement) {
		this._obj = obj;
	}

	public getObj(): PromptElement | null {
		return this._obj;
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

	public appendPieceJSON(data: JSONT.PieceJSON): PromptTreeElement {
		const child = PromptTreeElement.fromJSON(this._children.length, data);
		this._children.push(child);
		return child;
	}

	public appendStringChild(
		text: string,
		priority?: number,
		metadata?: PromptMetadata[],
		sortIndex = this._children.length,
		lineBreakBefore = false
	) {
		this._children.push(new PromptText(this, sortIndex, text, priority, metadata, lineBreakBefore));
	}

	public appendLineBreak(priority?: number, sortIndex = this._children.length): void {
		this._children.push(new PromptText(this, sortIndex, '\n', priority));
	}

	public toJSON(): JSONT.PieceJSON {
		const json: JSONT.PieceJSON = {
			type: JSONT.PromptNodeType.Piece,
			ctor: JSONT.PieceCtorKind.Other,
			children: this._children
				.slice()
				.sort((a, b) => a.childIndex - b.childIndex)
				.map(c => c.toJSON()),
			priority: this._obj?.props.priority,
			references: this._metadata
				.filter(m => m instanceof ReferenceMetadata)
				.map(r => r.reference.toJSON()),
		};

		if (this._obj instanceof BaseChatMessage) {
			json.ctor = JSONT.PieceCtorKind.BaseChatMessage;
			json.props = {
				role: this._obj.props.role,
				name: this._obj.props.name,
				priority: this._obj.props.priority,
				toolCalls: this._obj.props.toolCalls,
				toolCallId: this._obj.props.toolCallId,
			};
		} else if (this._obj instanceof BaseImageMessage) {
			json.ctor = JSONT.PieceCtorKind.ImageChatMessage;
			json.props = {
				imageUrl: this._obj.props.imageUrl,
				detail: this._obj.props.detail,
				priority: this._obj.props.priority,
			};
		}

		return json;
	}

	public materialize(): MaterializedChatMessage | MaterializedContainer | MaterializedChatMesageImage {
		this._children.sort((a, b) => a.childIndex - b.childIndex);
		if (this._obj instanceof BaseChatMessage) {
			if (!this._obj.props.role) {
				throw new Error(`Invalid ChatMessage!`);
			}

			if (this._obj instanceof BaseImageMessage) {
				// #region materialize baseimage
				const parent = new MaterializedChatMesageImage(
					1,
					ChatRole.User,
					this._obj.props.imageUrl,
					this._obj.props.priority ?? Number.MAX_SAFE_INTEGER,
					this._metadata,
					LineBreakBefore.None,
					[],
					this._obj.props.detail ?? undefined)
				return parent;
			}

			const parent = new MaterializedChatMessage(
				this.id,
				this._obj.props.role,
				this._obj.props.name,
				this._obj instanceof AssistantMessage ? this._obj.props.toolCalls : undefined,
				this._obj instanceof ToolMessage ? this._obj.props.toolCallId : undefined,
				this._obj.props.priority ?? Number.MAX_SAFE_INTEGER,
				this._metadata,
				this._children.map(child => child.materialize())
			);
			return parent;
		} else {
			let flags = 0;
			if (this._obj instanceof LegacyPrioritization) flags |= ContainerFlags.IsLegacyPrioritization;
			if (this._obj instanceof Chunk) flags |= ContainerFlags.IsChunk;
			if (this._obj?.props.passPriority) flags |= ContainerFlags.PassPriority;

			return new MaterializedContainer(
				this.id,
				this._obj?.constructor.name,
				this._obj?.props.priority ?? (this._obj?.props.passPriority ? 0 : Number.MAX_SAFE_INTEGER),
				this._children.map(child => child.materialize()),
				this._metadata,
				flags
			);
		}
	}

	public addMetadata(metadata: PromptMetadata): void {
		this._metadata.push(metadata);
	}

	public *elements(): Iterable<PromptTreeElement> {
		yield this;
		for (const child of this._children) {
			if (child instanceof PromptTreeElement) {
				yield* child.elements();
			}
		}
	}
}

class PromptText {
	public static fromJSON(
		parent: PromptTreeElement,
		index: number,
		json: JSONT.TextJSON
	): PromptText {
		return new PromptText(
			parent,
			index,
			json.text,
			json.priority,
			json.references?.map(r => new ReferenceMetadata(PromptReference.fromJSON(r))),
			json.lineBreakBefore
		);
	}

	public readonly kind = PromptNodeType.Text;

	constructor(
		public readonly parent: PromptTreeElement,
		public readonly childIndex: number,
		public readonly text: string,
		public readonly priority?: number,
		public readonly metadata?: PromptMetadata[],
		public readonly lineBreakBefore = false
	) {}

	public collectLeafs(result: LeafPromptNode[]) {
		result.push(this);
	}

	public materialize() {
		const lineBreak = this.lineBreakBefore
			? LineBreakBefore.Always
			: this.childIndex === 0
			? LineBreakBefore.IfNotTextSibling
			: LineBreakBefore.None;
		return new MaterializedChatMessageTextChunk(
			this.text,
			this.priority ?? Number.MAX_SAFE_INTEGER,
			this.metadata || [],
			lineBreak
		);
	}

	public toJSON(): JSONT.TextJSON {
		return {
			type: JSONT.PromptNodeType.Text,
			priority: this.priority,
			text: this.text,
			references: this.metadata
				?.filter(m => m instanceof ReferenceMetadata)
				.map(r => r.reference.toJSON()),
			lineBreakBefore: this.lineBreakBefore,
		};
	}
}

function isFragmentCtor(template: PromptPiece): boolean {
	return (typeof template.ctor === 'function' && template.ctor.isFragment) ?? false;
}

function softAssertNever(x: never): void {
	// note: does not actually throw, because we want to handle any unknown cases
	// gracefully for forwards-compatibility
}

function isDefined<T>(x: T | undefined): x is T {
	return x !== undefined;
}

class InternalMetadata extends PromptMetadata {}

class ReferenceMetadata extends InternalMetadata {
	constructor(public readonly reference: PromptReference) {
		super();
	}
}

function iterableToArray<T>(t: Iterable<T>): ReadonlyArray<T> {
	if (isIterable(t)) {
		return Array.from(t);
	}

	return t;
}

function isIterable(t: unknown): t is Iterable<any> {
	return !!t && typeof (t as any)[Symbol.iterator] === 'function';
}
