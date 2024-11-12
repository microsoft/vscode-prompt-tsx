import {
	AssistantMessage,
	BasePromptElementProps,
	PrioritizedList,
	PromptElement,
	PromptPiece,
	PromptSizing,
	SystemMessage,
	UserMessage,
} from '@vscode/prompt-tsx';
import {
	CancellationToken,
	ChatContext,
	ChatRequestTurn,
	ChatResponseMarkdownPart,
	ChatResponseTurn,
	Progress,
} from 'vscode';
import { ChatResponsePart } from '../dist/base/vscodeTypes';

interface IMyPromptProps extends BasePromptElementProps {
	history: ChatContext['history'];
	userQuery: string;
}

/**
 * Including conversation history in your prompt is important as it allows the
 * user to ask followup questions to previous messages. However, you want to
 * make sure its priority is treated appropriately because history can
 * grow very large over time.
 *
 * We've found that the pattern which makes the most sense is usually to prioritize, in order:
 *
 * 1. The base prompt instructions, then
 * 1. The current user query, then
 * 1. The last couple turns of chat history, then
 * 1. Any supporting data, then
 * 1. As much of the remaining history as you can fit.
 *
 * For this reason, we split the history in two parts in the prompt, where
 * recent prompt turns are prioritized above general contextual information.
 */
export class MyPrompt extends PromptElement<IMyPromptProps> {
	render() {
		return (
			<>
				<SystemMessage priority={100}>
					Here are your base instructions. They have the highest priority because you want to make
					sure they're always included!
				</SystemMessage>
				{/* The remainder of the history has the lowest priority since it's less relevant */}
				<HistoryMessages history={this.props.history.slice(0, -2)} priority={0} />
				{/* The last 2 history messages are preferred over any workspace context we have vlow */}
				<HistoryMessages history={this.props.history.slice(-2)} priority={80} />
				{/* The user query is right behind the system message in priority */}
				<UserMessage priority={90}>{this.props.userQuery}</UserMessage>
				<UserMessage priority={70}>
					With a slightly lower priority, you can include some contextual data about the workspace
					or files here...
				</UserMessage>
			</>
		);
	}
}

interface IHistoryProps extends BasePromptElementProps {
	history: ChatContext['history'];
	newer: number; // last 2 message priority values
	older: number; // previous message priority values
	passPriority: true; // require this prop be set!
}

/**
 * We can wrap up this history element to be a little easier to use. `prompt-tsx`
 * has a `passPriority` attribute which allows an element to act as a 'pass-through'
 * container, so that its children are pruned as if they were direct children of
 * the parent. With this component, the elements
 *
 * ```
 * <HistoryMessages history={this.props.history.slice(0, -2)} priority={0} />
 * <HistoryMessages history={this.props.history.slice(-2)} priority={80} />
 * ```
 *
 * ...can equivalently be expressed as:
 *
 * ```
 * <History history={this.props.history} passPriority older={0} recentPriority={80} />
 * ```
 */
export class History extends PromptElement<IHistoryProps> {
	render(): PromptPiece {
		return (
			<>
				<HistoryMessages history={this.props.history.slice(0, -2)} priority={this.props.older} />
				<HistoryMessages history={this.props.history.slice(0, -2)} priority={this.props.newer} />
			</>
		);
	}
}

interface IHistoryMessagesProps extends BasePromptElementProps {
	history: ChatContext['history'];
}

/**
 * The History element simply lists user and assistant messages from the chat
 * context. If things like tool calls or file trees are relevant for, your
 * case, you can make this element more complex to handle those cases.
 */
export class HistoryMessages extends PromptElement<IHistoryMessagesProps> {
	render(): PromptPiece {
		const history: (UserMessage | AssistantMessage)[] = [];
		for (const turn of this.props.history) {
			if (turn instanceof ChatRequestTurn) {
				history.push(<UserMessage>{turn.prompt}</UserMessage>);
			} else if (turn instanceof ChatResponseTurn) {
				history.push(
					<AssistantMessage name={turn.participant}>
						{chatResponseToMarkdown(turn)}
					</AssistantMessage>
				);
			}
		}
		return (
			<PrioritizedList priority={0} descending={false}>
				{history}
			</PrioritizedList>
		);
	}
}

const chatResponseToMarkdown = (response: ChatResponseTurn) => {
	let str = '';
	for (const part of response.response) {
		if (response instanceof ChatResponseMarkdownPart) {
			str += part.value;
		}
	}

	return str;
};
