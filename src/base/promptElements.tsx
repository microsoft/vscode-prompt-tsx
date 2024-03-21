/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ChatRole } from './openai';
import { PromptElement } from './promptElement';
import { BasePromptElementProps } from './types';

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

/**
 * A chunk of single-line or multi-line text that is a direct child of a {@link ChatMessagePromptElement}.
 *
 * TextChunks can only have text literals or intrinsic attributes as children.
 * Like other {@link PromptElement}s, it can specify `priority` to determine how it should be prioritized.
 */
export class TextChunk extends PromptElement {
	render() {
		return <>{this.props.children}</>;
	}
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
