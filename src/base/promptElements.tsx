/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	CancellationToken,
	LanguageModelPromptTsxPart,
	LanguageModelTextPart,
	LanguageModelToolResult,
} from 'vscode';
import { contentType, Raw } from '.';
import { PromptElement } from './promptElement';
import {
	BasePromptElementProps,
	PromptElementCtor,
	PromptElementProps,
	PromptPiece,
	PromptPieceChild,
	PromptSizing,
} from './types';
import { PromptElementJSON } from './jsonTypes';

export type ChatMessagePromptElement = SystemMessage | UserMessage | AssistantMessage;

export function isChatMessagePromptElement(element: unknown): element is ChatMessagePromptElement {
	return (
		element instanceof SystemMessage ||
		element instanceof UserMessage ||
		element instanceof AssistantMessage
	);
}

export interface ChatMessageProps extends BasePromptElementProps {
	role?: Raw.ChatRole;
	name?: string;
}

export class BaseChatMessage<
	T extends ChatMessageProps = ChatMessageProps
> extends PromptElement<T> {
	render() {
		return <>{this.props.children}</>;
	}
}

/**
 * A {@link PromptElement} which can be rendered to an OpenAI system chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export class SystemMessage extends BaseChatMessage {
	constructor(props: ChatMessageProps) {
		props.role = Raw.ChatRole.System;
		super(props);
	}
}

/**
 * A {@link PromptElement} which can be rendered to an OpenAI user chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export class UserMessage extends BaseChatMessage {
	constructor(props: ChatMessageProps) {
		props.role = Raw.ChatRole.User;
		super(props);
	}
}

export interface ToolCall {
	id: string;
	function: ToolFunction;
	type: 'function';
	/**
	 * A `<KeepWith />` element, created from {@link useKeepWith}, that wraps
	 * the tool result. This will ensure that if the tool result is pruned,
	 * the tool call is also pruned to avoid errors.
	 */
	keepWith?: KeepWithCtor;
}

export interface ToolFunction {
	arguments: string;
	name: string;
}

export interface AssistantMessageProps extends ChatMessageProps {
	/**
	 * Optional OpenAI response phase indicator for assistant output.
	 */
	phase?: 'commentary' | 'final_answer';
	toolCalls?: ToolCall[];
}

/**
 * A {@link PromptElement} which can be rendered to an OpenAI assistant chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export class AssistantMessage extends BaseChatMessage<AssistantMessageProps> {
	constructor(props: AssistantMessageProps) {
		props.role = Raw.ChatRole.Assistant;
		super(props);
	}
}

const WHITESPACE_RE = /\s+/g;

export interface ToolMessageProps extends ChatMessageProps {
	toolCallId: string;
}

/**
 * A {@link PromptElement} which can be rendered to an OpenAI tool chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export class ToolMessage extends BaseChatMessage<ToolMessageProps> {
	constructor(props: ToolMessageProps) {
		props.role = Raw.ChatRole.Tool;
		super(props);
	}
}

export interface TextChunkProps extends BasePromptElementProps {
	/**
	 * If defined, the text chunk will potentially truncate its contents at the
	 * last occurrence of the string or regular expression to ensure its content
	 * fits within in token budget.
	 *
	 * {@see BasePromptElementProps} for options to control how the token budget
	 * is allocated.
	 */
	breakOn?: RegExp | string;

	/** A shortcut for setting {@link breakOn} to `/\s+/g` */
	breakOnWhitespace?: boolean;
}

/**
 * @property {string} src - The source of the image. This should be a raw base64 string.
 * @property {'low' | 'high' | 'auto'} [detail] - Optional. The detail level of the image. Can be either 'low', 'high' or 'auto'. If not specified, `auto` is used.
 * @property {ImageMediaType} [mimeType] - Optional. The MIME type of the image. Only used for non-base64 URLs.
 */
export interface ImageProps extends BasePromptElementProps {
	src: string;
	detail?: 'low' | 'high' | 'auto';
	mimeType?: string;
}

/**
 * A chunk of single-line or multi-line text that is a direct child of a {@link ChatMessagePromptElement}.
 *
 * TextChunks can only have text literals or intrinsic attributes as children.
 * It supports truncating text to fix the token budget if passed a {@link TextChunkProps.tokenizer} and {@link TextChunkProps.breakOn} behavior.
 * Like other {@link PromptElement}s, it can specify `priority` to determine how it should be prioritized.
 */
export class TextChunk extends PromptElement<TextChunkProps, PromptPiece> {
	async prepare(
		sizing: PromptSizing,
		_progress?: unknown,
		token?: CancellationToken
	): Promise<PromptPiece> {
		const breakOn = this.props.breakOnWhitespace ? WHITESPACE_RE : this.props.breakOn;
		if (!breakOn) {
			return <>{this.props.children}</>;
		}

		let fullText = '';
		const intrinsics: PromptPiece[] = [];
		for (const child of this.props.children || []) {
			if (child && typeof child === 'object') {
				if (typeof child.ctor !== 'string') {
					throw new Error('TextChunk children must be text literals or intrinsic attributes.');
				} else if (child.ctor === 'br') {
					fullText += '\n';
				} else {
					intrinsics.push(child);
				}
			} else if (child != null) {
				fullText += child;
			}
		}

		const text = await getTextContentBelowBudget(sizing, breakOn, fullText, token);
		return (
			<>
				{intrinsics}
				{text}
			</>
		);
	}

	render(piece: PromptPiece) {
		return piece;
	}
}

async function getTextContentBelowBudget(
	sizing: PromptSizing,
	breakOn: string | RegExp,
	fullText: string,
	cancellation: CancellationToken | undefined
) {
	if (breakOn instanceof RegExp) {
		if (!breakOn.global) {
			throw new Error(`\`breakOn\` expression must have the global flag set (got ${breakOn})`);
		}

		breakOn.lastIndex = 0;
	}

	let outputText = '';
	let lastIndex = -1;
	while (lastIndex < fullText.length) {
		let index: number;
		if (typeof breakOn === 'string') {
			index = fullText.indexOf(breakOn, lastIndex === -1 ? 0 : lastIndex + breakOn.length);
		} else {
			index = breakOn.exec(fullText)?.index ?? -1;
		}

		if (index === -1) {
			index = fullText.length;
		}

		const next = outputText + fullText.slice(Math.max(0, lastIndex), index);
		if (
			(await sizing.countTokens(
				{ type: Raw.ChatCompletionContentPartKind.Text, text: next },
				cancellation
			)) > sizing.tokenBudget
		) {
			return outputText;
		}

		outputText = next;
		lastIndex = index;
	}

	return outputText;
}

export class Image extends PromptElement<ImageProps> {
	constructor(props: ImageProps) {
		super(props);
	}

	render() {
		return <>{this.props.children}</>;
	}
}

export interface PrioritizedListProps extends BasePromptElementProps {
	/**
	 * Priority of the list element.
	 * All rendered elements in this list receive a priority that is offset from this value.
	 */
	priority?: number;
	/**
	 * If `true`, assign higher priority to elements declared earlier in this list.
	 */
	descending: boolean;
}

/**
 * A utility for assigning priorities to a list of prompt elements.
 */
export class PrioritizedList extends PromptElement<PrioritizedListProps> {
	override render() {
		const { children, priority = 0, descending } = this.props;
		if (!children) {
			return;
		}

		return (
			<>
				{children.map((child, i) => {
					if (!child) {
						return;
					}

					const thisPriority = descending
						? // First element in array of children has highest priority
						  priority - i
						: // Last element in array of children has highest priority
						  priority - children.length + i;

					if (typeof child !== 'object') {
						return <TextChunk priority={thisPriority}>{child}</TextChunk>;
					}

					child.props ??= {};
					child.props.priority = thisPriority;
					return child;
				})}
			</>
		);
	}
}

export interface IToolResultProps extends BasePromptElementProps {
	/**
	 * Base priority of the tool data. All tool data will be scoped to this priority.
	 */
	priority?: number;

	/**
	 * Tool result from VS Code.
	 */
	data: LanguageModelToolResult;
}

/**
 * A utility to include the result of a tool called using the `vscode.lm.invokeTool` API.
 */
export class ToolResult extends PromptElement<IToolResultProps> {
	render(): Promise<PromptPiece | undefined> | PromptPiece | undefined {
		// note: future updates to content types should be handled here for backwards compatibility
		return (
			<>
				{this.props.data.content.map(part => {
					if (part && typeof (part as LanguageModelTextPart).value === 'string') {
						return (part as LanguageModelTextPart).value;
					} else if (
						part &&
						(part as LanguageModelPromptTsxPart).value &&
						typeof (part as { value: PromptElementJSON }).value.node === 'object'
					) {
						return (
							<elementJSON data={(part as LanguageModelPromptTsxPart).value as PromptElementJSON} />
						);
					}
				})}
			</>
		);
	}
}

/**
 * Marker element that uses the legacy global prioritization algorithm (0.2.x
 * if this library) for pruning child elements. This will be removed in
 * the future.
 *
 * @deprecated
 */
export class LegacyPrioritization extends PromptElement {
	render() {
		return <>{this.props.children}</>;
	}
}

/**
 * Marker element that ensures all of its children are either included, or
 * not included. This is similar to the `<TextChunk />` element, but it is more
 * basic and can contain extrinsic children.
 */
export class Chunk extends PromptElement<BasePromptElementProps> {
	render() {
		return <>{this.props.children}</>;
	}
}

export interface ExpandableProps extends BasePromptElementProps {
	value: (sizing: PromptSizing) => string | Promise<string>;
}

/**
 * An element that can expand to fill the remaining token budget. Takes
 * a `value` function that is initially called with the element's token budget,
 * and may be called multiple times with the new token budget as the prompt
 * is resized.
 */
export class Expandable extends PromptElement<ExpandableProps> {
	async render(_state: void, sizing: PromptSizing): Promise<PromptPiece> {
		return <>{await this.props.value(sizing)}</>;
	}
}

export interface TokenLimitProps extends BasePromptElementProps {
	max: number;
}

/**
 * An element that ensures its children don't exceed a certain number of
 * `maxTokens`. Its contents are pruned to fit within the budget before
 * the overall prompt pruning is run.
 */
export class TokenLimit extends PromptElement<TokenLimitProps> {
	render(): PromptPiece {
		return <>{this.props.children}</>;
	}
}

export abstract class AbstractKeepWith extends PromptElement {
	public abstract readonly id: number;
}

let keepWidthId = 0;

export type KeepWithCtor = {
	new (props: PromptElementProps<BasePromptElementProps>): AbstractKeepWith;
	id: number;
};

/**
 * Returns a PromptElement that ensures each wrapped element is retained only
 * so long as each other wrapped is not empty.
 *
 * This is useful when dealing with tool calls, for example. In that case,
 * your tool call request should only be rendered if the tool call response
 * survived prioritization. In that case, you implement a `render` function
 * like so:
 *
 * ```
 * render() {
 *   const KeepWith = useKeepWith();
 *   return <>
 *     <KeepWith priority={2}><ToolCallRequest>...</ToolCallRequest></KeepWith>
 *     <KeepWith priority={1}><ToolCallResponse>...</ToolCallResponse></KeepWith>
 *   </>;
 * }
 * ```
 *
 * Unlike `<Chunk />`, which blocks pruning of any child elements and simply
 * removes them as a block, `<KeepWith />` in this case will allow the
 * `ToolCallResponse` to be pruned, and if it's fully pruned it will also
 * remove the `ToolCallRequest`.
 */
export function useKeepWith(): KeepWithCtor {
	const id = keepWidthId++;
	return class KeepWith extends AbstractKeepWith {
		public static readonly id = id;

		public readonly id = id;

		render(): PromptPiece {
			return <>{this.props.children}</>;
		}
	};
}

export interface IfEmptyProps extends BasePromptElementProps {
	alt: PromptPieceChild;
}

/**
 * An element that returns its `alt` prop if its children are empty at the
 * time when it's rendered. This is especially useful when you require
 * fallback logic for opaque child data, such as tool calls.
 */
export class IfEmpty extends PromptElement<IfEmptyProps> {
	render(): PromptPiece {
		return (
			<>
				<LogicalWrapper>{this.props.alt}</LogicalWrapper>
				<LogicalWrapper flexGrow={1}>{this.props.children}</LogicalWrapper>
			</>
		);
	}
}

export class LogicalWrapper extends PromptElement {
	render(): PromptPiece {
		return <>{this.props.children}</>;
	}
}
