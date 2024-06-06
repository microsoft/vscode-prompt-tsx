/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ChatRole } from './openai';
import { PromptElement } from './promptElement';
import { ITokenizer } from './tokenizer/tokenizer';
import { BasePromptElementProps, PromptPiece, PromptSizing } from './types';

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

export class BaseChatMessage extends PromptElement<ChatMessageProps> {
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

/**
 * A {@link PromptElement} which can be rendered to an OpenAI assistant chat message.
 *
 * See {@link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages}
 */
export class AssistantMessage extends BaseChatMessage {
	constructor(props: ChatMessageProps) {
		props.role = ChatRole.Assistant;
		super(props);
	}
}

export interface TextChunkProps extends BasePromptElementProps {
	/**
	 * A tokenizer is required when setting {@link breakOn} or {@link breakOnWhitespace}.
	 */
	tokenizer?: ITokenizer;

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

/**
 * A chunk of single-line or multi-line text that is a direct child of a {@link ChatMessagePromptElement}.
 *
 * TextChunks can only have text literals or intrinsic attributes as children.
 * It supports truncating text to fix the token budget if passed a {@link TextChunkProps.tokenizer} and {@link TextChunkProps.breakOn} behavior.
 * Like other {@link PromptElement}s, it can specify `priority` to determine how it should be prioritized.
 */
export class TextChunk extends PromptElement<TextChunkProps> {
	render(_state: void, sizing: PromptSizing) {
		const breakOn = this.props.breakOnWhitespace ? WHITESPACE_RE : this.props.breakOn;
		if (!breakOn) {
			return <>{this.props.children}</>;
		}

		const tokenizer = this.props.tokenizer;
		if (!tokenizer) {
			throw new Error('A tokenizer is required in <TextChunk /> when setting breakOn or breakOnWhitespace.');
		}

		let fullText = '';
		const instrinics: PromptPiece[] = [];
		for (const child of this.props.children || []) {
			if (child && typeof child === 'object') {
				if (typeof child.ctor !== 'string') {
					throw new Error('TextChunk children must be text literals or intrinsic attributes.');
				} else if (child.ctor === 'br') {
					fullText += '\n';
				} else {
					instrinics.push(child);
				}
			} else if (child != null) {
				fullText += child;
			}
		}

		const text = getTextContentBelowBudget(tokenizer, breakOn, fullText, sizing.tokenBudget);

		// Note: TextChunk is treated specially in the renderer to preserve references
		// correctly. Changing this structure also requires changes in PromptRendere._handlePromptChildren
		return <>{instrinics}{text}</>;
	}
}

function getTextContentBelowBudget(tokenizer: ITokenizer, breakOn: string | RegExp, fullText: string, budget: number) {
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
		if (tokenizer.tokenLength(next) > budget) {
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
					child.props ??= {};
					child.props.priority = this.props.descending
						? // First element in array of children has highest priority
						this.props.priority - i
						: // Last element in array of children has highest priority
						this.props.priority - children.length + i;
					return child;
				})}
			</>
		);
	}
}
