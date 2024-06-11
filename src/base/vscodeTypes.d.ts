/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Command, Location, MarkdownString, Range, ThemeIcon, Uri } from 'vscode';

/**
 * Represents a part of a chat response that is formatted as Markdown.
 */
export class ChatResponseMarkdownPart {
	/**
	 * A markdown string or a string that should be interpreted as markdown.
	 */
	value: MarkdownString;

	/**
	 * Create a new ChatResponseMarkdownPart.
	 *
	 * @param value A markdown string or a string that should be interpreted as markdown. The boolean form of {@link MarkdownString.isTrusted} is NOT supported.
	 */
	constructor(value: string | MarkdownString);
}

/**
 * Represents a file tree structure in a chat response.
 */
export interface ChatResponseFileTree {
	/**
	 * The name of the file or directory.
	 */
	name: string;

	/**
	 * An array of child file trees, if the current file tree is a directory.
	 */
	children?: ChatResponseFileTree[];
}

/**
 * Represents a part of a chat response that is a file tree.
 */
export class ChatResponseFileTreePart {
	/**
	 * File tree data.
	 */
	value: ChatResponseFileTree[];

	/**
	 * The base uri to which this file tree is relative
	 */
	baseUri: Uri;

	/**
	 * Create a new ChatResponseFileTreePart.
	 * @param value File tree data.
	 * @param baseUri The base uri to which this file tree is relative.
	 */
	constructor(value: ChatResponseFileTree[], baseUri: Uri);
}

/**
 * Represents a part of a chat response that is an anchor, that is rendered as a link to a target.
 */
export class ChatResponseAnchorPart {
	/**
	 * The target of this anchor.
	 */
	value: Uri | Location;

	/**
	 * An optional title that is rendered with value.
	 */
	title?: string;

	/**
	 * Create a new ChatResponseAnchorPart.
	 * @param value A uri or location.
	 * @param title An optional title that is rendered with value.
	 */
	constructor(value: Uri | Location, title?: string);
}

/**
 * Represents a part of a chat response that is a progress message.
 */
export class ChatResponseProgressPart {
	/**
	 * The progress message
	 */
	value: string;

	/**
	 * Create a new ChatResponseProgressPart.
	 * @param value A progress message
	 */
	constructor(value: string);
}

/**
 * Represents a part of a chat response that is a reference, rendered separately from the content.
 */
export class ChatResponseReferencePart {
	/**
	 * The reference target.
	 */
	value: Uri | Location;

	/**
	 * The icon for the reference.
	 */
	iconPath?: Uri | ThemeIcon | {
		/**
		 * The icon path for the light theme.
		 */
		light: Uri;
		/**
		 * The icon path for the dark theme.
		 */
		dark: Uri;
	};

	/**
	 * Create a new ChatResponseReferencePart.
	 * @param value A uri or location
	 * @param iconPath Icon for the reference shown in UI
	 */
	constructor(value: Uri | Location, iconPath?: Uri | ThemeIcon | {
		/**
		 * The icon path for the light theme.
		 */
		light: Uri;
		/**
		 * The icon path for the dark theme.
		 */
		dark: Uri;
	});
}

/**
 * Represents a part of a chat response that is a button that executes a command.
 */
export class ChatResponseCommandButtonPart {
	/**
	 * The command that will be executed when the button is clicked.
	 */
	value: Command;

	/**
	 * Create a new ChatResponseCommandButtonPart.
	 * @param value A Command that will be executed when the button is clicked.
	 */
	constructor(value: Command);
}

/**
 * Represents the different chat response types.
 */
export type ChatResponsePart = ChatResponseMarkdownPart | ChatResponseFileTreePart | ChatResponseAnchorPart
	| ChatResponseProgressPart | ChatResponseReferencePart | ChatResponseCommandButtonPart;


export interface ChatDocumentContext {
	uri: Uri;
	version: number;
	ranges: Range[];
}


/**
 * Represents the role of a chat message. This is either the user or the assistant.
 */
export enum LanguageModelChatMessageRole {
	/**
	 * The user role, e.g the human interacting with a language model.
	 */
	User = 1,

	/**
	 * The assistant role, e.g. the language model generating responses.
	 */
	Assistant = 2,
}

/**
 * Represents a message in a chat. Can assume different roles, like user or assistant.
 */
export class LanguageModelChatMessage {

	/**
	 * Utility to create a new user message.
	 *
	 * @param content The content of the message.
	 * @param name The optional name of a user for the message.
	 */
	static User(content: string, name?: string): LanguageModelChatMessage;

	/**
	 * Utility to create a new assistant message.
	 *
	 * @param content The content of the message.
	 * @param name The optional name of a user for the message.
	 */
	static Assistant(content: string, name?: string): LanguageModelChatMessage;

	/**
	 * The role of this message.
	 */
	role: LanguageModelChatMessageRole;

	/**
	 * The content of this message.
	 */
	content: string;

	/**
	 * The optional name of a user for this message.
	 */
	name: string | undefined;

	/**
	 * Create a new user message.
	 *
	 * @param role The role of the message.
	 * @param content The content of the message.
	 * @param name The optional name of a user for the message.
	 */
	constructor(role: LanguageModelChatMessageRole, content: string, name?: string);
}

/**
 * Options for making a chat request using a language model.
 *
 * @see {@link LanguageModelChat.sendRequest}
 */
export interface LanguageModelChatRequestOptions {

	/**
	 * A human-readable message that explains why access to a language model is needed and what feature is enabled by it.
	 */
	justification?: string;

	/**
	 * A set of options that control the behavior of the language model. These options are specific to the language model
	 * and need to be lookup in the respective documentation.
	 */
	modelOptions?: { [name: string]: any };
}


/**
 * Represents a language model response.
 *
 * @see {@link LanguageModelAccess.chatRequest}
*/
export interface LanguageModelChatResponse {

	/**
	 * An async iterable that is a stream of text chunks forming the overall response.
	 *
	 * *Note* that this stream will error when during data receiving an error occurs. Consumers of
	 * the stream should handle the errors accordingly.
	 *
	 * To cancel the stream, the consumer can {@link CancellationTokenSource.cancel cancel} the token that was used to make the request
	 * or break from the for-loop.
	 *
	 * @example
	 * ```ts
	 * try {
	 *   // consume stream
	 *   for await (const chunk of response.text) {
	 *    console.log(chunk);
	 *   }
	 *
	 * } catch(e) {
	 *   // stream ended with an error
	 *   console.error(e);
	 * }
	 * ```
	 */
	text: AsyncIterable<string>;
}

/**
	 * Represents a language model for making chat requests.
	 *
	 * @see {@link lm.selectChatModels}
	 */
export interface LanguageModelChat {

	/**
	 * Human-readable name of the language model.
	 */
	readonly name: string;

	/**
	 * Opaque identifier of the language model.
	 */
	readonly id: string;

	/**
	 * A well-known identifier of the vendor of the language model. An example is `copilot`, but
	 * values are defined by extensions contributing chat models and need to be looked up with them.
	 */
	readonly vendor: string;

	/**
	 * Opaque family-name of the language model. Values might be `gpt-3.5-turbo`, `gpt4`, `phi2`, or `llama`
	 * but they are defined by extensions contributing languages and subject to change.
	 */
	readonly family: string;

	/**
	 * Opaque version string of the model. This is defined by the extension contributing the language model
	 * and subject to change.
	 */
	readonly version: string;

	/**
	 * The maximum number of tokens that can be sent to the model in a single request.
	 */
	readonly maxInputTokens: number;

	/**
	 * Make a chat request using a language model.
	 *
	 * *Note* that language model use may be subject to access restrictions and user consent. Calling this function
	 * for the first time (for a extension) will show a consent dialog to the user and because of that this function
	 * must _only be called in response to a user action!_ Extension can use {@link LanguageModelAccessInformation.canSendRequest}
	 * to check if they have the necessary permissions to make a request.
	 *
	 * This function will return a rejected promise if making a request to the language model is not
	 * possible. Reasons for this can be:
	 *
	 * - user consent not given, see {@link LanguageModelError.NoPermissions `NoPermissions`}
	 * - model does not exist anymore, see {@link LanguageModelError.NotFound `NotFound`}
	 * - quota limits exceeded, see {@link LanguageModelError.Blocked `Blocked`}
	 * - other issues in which case extension must check {@link LanguageModelError.cause `LanguageModelError.cause`}
	 *
	 * @param messages An array of message instances.
	 * @param options Options that control the request.
	 * @param token A cancellation token which controls the request. See {@link CancellationTokenSource} for how to create one.
	 * @returns A thenable that resolves to a {@link LanguageModelChatResponse}. The promise will reject when the request couldn't be made.
	 */
	sendRequest(messages: LanguageModelChatMessage[], options?: LanguageModelChatRequestOptions, token?: CancellationToken): Thenable<LanguageModelChatResponse>;

	/**
	 * Count the number of tokens in a message using the model specific tokenizer-logic.

	 * @param text A string or a message instance.
	 * @param token Optional cancellation token.  See {@link CancellationTokenSource} for how to create one.
	 * @returns A thenable that resolves to the number of tokens.
	 */
	countTokens(text: string | LanguageModelChatMessage, token?: CancellationToken): Thenable<number>;
}

// TODO@API capabilities

export type JSONSchema = object;

// API -> LM: an tool/function that is available to the language model
export interface LanguageModelChatFunction {
	name: string;
	description: string;
	parametersSchema: JSONSchema;
}

// API -> LM: add tools as request option
export interface LanguageModelChatRequestOptions {
	// TODO@API this will a heterogeneous array of different types of tools
	tools?: LanguageModelChatFunction[];
}

// LM -> USER: function that should be used
export class LanguageModelChatResponseFunctionUsePart {
	name: string;
	parameters: any;

	constructor(name: string, parameters: any);
}

// LM -> USER: text chunk
export class LanguageModelChatResponseTextPart {
	value: string;

	constructor(value: string);
}

export interface LanguageModelChatResponse {

	stream?: AsyncIterable<LanguageModelChatResponseTextPart | LanguageModelChatResponseFunctionUsePart>;
}


// USER -> LM: the result of a function call
export class LanguageModelChatMessageFunctionResultPart {
	name: string;
	content: string;
	isError: boolean;

	constructor(name: string, content: string, isError?: boolean);
}

export interface LanguageModelChatMessage {
	content2?: string | LanguageModelChatMessageFunctionResultPart;
}
