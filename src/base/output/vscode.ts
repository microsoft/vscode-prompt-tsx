import type * as vscodeType from 'vscode';
import * as Raw from './rawTypes';

function onlyStringContent(content: Raw.ChatCompletionContentPart[]): string {
	return content
		.filter(part => part.type === Raw.ChatCompletionContentPartKind.Text)
		.map(part => (part as Raw.ChatCompletionContentPartText).text)
		.join('');
}

let vscode: typeof vscodeType;

export function toVsCodeChatMessage(
	m: Raw.ChatMessage
): vscodeType.LanguageModelChatMessage | undefined {
	vscode ??= require('vscode');

	switch (m.role) {
		case Raw.ChatRole.Assistant:
			const message: vscodeType.LanguageModelChatMessage =
				vscode.LanguageModelChatMessage.Assistant(onlyStringContent(m.content), m.name);
			if (m.toolCalls) {
				message.content = [
					new vscode.LanguageModelTextPart(onlyStringContent(m.content)),
					...m.toolCalls.map(tc => {
						// prompt-tsx got args passed as a string, here we assume they are JSON because the vscode-type wants an object
						let parsedArgs: object;
						try {
							parsedArgs = JSON.parse(tc.function.arguments);
						} catch (err) {
							throw new Error('Invalid JSON in tool call arguments for tool call: ' + tc.id);
						}

						return new vscode.LanguageModelToolCallPart(tc.id, tc.function.name, parsedArgs);
					}),
				];
			}
			return message;
		case Raw.ChatRole.User:
			return vscode.LanguageModelChatMessage.User(onlyStringContent(m.content), m.name);
		case Raw.ChatRole.Tool: {
			const message: vscodeType.LanguageModelChatMessage = vscode.LanguageModelChatMessage.User('');
			message.content = [
				new vscode.LanguageModelToolResultPart(m.toolCallId, [
					new vscode.LanguageModelTextPart(onlyStringContent(m.content)),
				]),
			];
			return message;
		}
		default:
			return undefined;
	}
}
/**
 * Converts an array of {@link ChatMessage} objects to an array of corresponding {@link LanguageModelChatMessage VS Code chat messages}.
 * @param messages - The array of {@link ChatMessage} objects to convert.
 * @returns An array of {@link LanguageModelChatMessage VS Code chat messages}.
 */
export function toVsCodeChatMessages(
	messages: readonly Raw.ChatMessage[]
): vscodeType.LanguageModelChatMessage[] {
	return messages.map(toVsCodeChatMessage).filter(r => !!r);
}
