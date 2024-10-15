/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { contentType } from '.';
import { ChatRole } from './openai';
import { PromptElement } from './promptElement';
import { BasePromptElementProps, PromptPiece, PromptSizing } from './types';
import { LanguageModelToolResult } from './vscodeTypes';

export type ChatMessagePromptElement =
	| SystemMessage
	| UserMessage
	| AssistantMessage;

export function isChatMessagePromptElement(
	element: unknown
): element is ChatMessagePromptElement {
	return (
		element instanceof SystemMessage ||
		element instanceof UserMessage ||
		element instanceof AssistantMessage
	);
}

export interface ChatMessageProps extends BasePromptElementProps {
	role?: ChatRole;
	name?: string;
}

export class BaseChatMessage<T extends ChatMessageProps = ChatMessageProps> extends PromptElement<T> {
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
		props.role = ChatRole.System;
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
		props.role = ChatRole.User;
		super(props);
	}
}

export interface ToolCall {
	id: string;
	function: ToolFunction;
	type: 'function';
}

export interface ToolFunction {
	arguments: string;
	name: string;
}

export interface AssistantMessageProps extends ChatMessageProps {
	toolCalls?: ToolCall[];
}

/**
 * A {@link PromptElement} which can be rendered to an OpenAI assistant chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export class AssistantMessage extends BaseChatMessage<AssistantMessageProps> {
	constructor(props: AssistantMessageProps) {
		props.role = ChatRole.Assistant;
		super(props);
	}
}

const WHITESPACE_RE = /\s+/g;

/**
 * A {@link PromptElement} which can be rendered to an OpenAI function chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export class FunctionMessage extends BaseChatMessage {
	constructor(props: ChatMessageProps & { name: string }) {
		props.role = ChatRole.Function;
		super(props);
	}
}

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
		props.role = ChatRole.Tool;
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
 * A chunk of single-line or multi-line text that is a direct child of a {@link ChatMessagePromptElement}.
 *
 * TextChunks can only have text literals or intrinsic attributes as children.
 * It supports truncating text to fix the token budget if passed a {@link TextChunkProps.tokenizer} and {@link TextChunkProps.breakOn} behavior.
 * Like other {@link PromptElement}s, it can specify `priority` to determine how it should be prioritized.
 */
export class TextChunk extends PromptElement<TextChunkProps, PromptPiece> {
	async prepare(sizing: PromptSizing, _progress?: unknown, token?: CancellationToken): Promise<PromptPiece> {
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
		return <>{intrinsics}{text}</>;
	}

	render(piece: PromptPiece) {
		return piece;
	}
}

async function getTextContentBelowBudget(sizing: PromptSizing, breakOn: string | RegExp, fullText: string, cancellation: CancellationToken | undefined) {
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
		if (await sizing.countTokens(next, cancellation) > sizing.tokenBudget) {
			return outputText;
		}

		outputText = next;
		lastIndex = index;
	}

	return outputText;
}

export interface PrioritizedListProps extends BasePromptElementProps {
	/**
	 * Priority of the list element.
	 * All rendered elements in this list receive a priority that is offset from this value.
	 */
	priority: number;
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
		const children = this.props.children;
		if (!children) {
			return;
		}

		return (
			<>
				{children.map((child, i) => {
					if (!child) {
						return;
					}

					const priority = this.props.descending
						? // First element in array of children has highest priority
						this.props.priority - i
						: // Last element in array of children has highest priority
						this.props.priority - children.length + i;

					if (typeof child !== 'object') {
						return <TextChunk priority={priority}>{child}</TextChunk>;
					}

					child.props ??= {};
					child.props.priority = priority;
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
		if (this.props.data.hasOwnProperty(contentType)) {
			return <elementJSON data={this.props.data[contentType]} />;
		} else {
			return <UserMessage priority={this.priority}>{this.props.data.toString()}</UserMessage>;
		}
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
