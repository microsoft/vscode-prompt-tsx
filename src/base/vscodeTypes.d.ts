/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Command, Location, MarkdownString, ProviderResult, Range, ThemeIcon, Uri } from 'vscode';

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

export interface LanguageModelChatTool {
	// TODO@API should use "id" here to match vscode tools, or keep name to match OpenAI? Align everything.
	name: string;
	description: string;
	parametersSchema?: JSONSchema;
}

// API -> LM: add tools as request option
export interface LanguageModelChatRequestOptions {
	// TODO@API this will be a heterogeneous array of different types of tools
	tools?: LanguageModelChatTool[];

	/**
	 * Force a specific tool to be used.
	 */
	toolChoice?: string;
}

// LM -> USER: function that should be used
export class LanguageModelToolCallPart {
	name: string;
	toolCallId: string;
	parameters: any;

	constructor(name: string, toolCallId: string, parameters: any);
}

// LM -> USER: text chunk
export class LanguageModelTextPart {
	value: string;

	constructor(value: string);
}

export interface LanguageModelChatResponse {
	stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart>;
}


// USER -> LM: the result of a function call
export class LanguageModelToolResultPart {
	toolCallId: string;
	content: string;

	constructor(toolCallId: string, content: string);
}

export interface LanguageModelChatMessage {
	/**
	 * A heterogeneous array of other things that a message can contain as content.
	 * Some parts would be message-type specific for some models and wouldn't go together,
	 * but it's up to the chat provider to decide what to do about that.
	 * Can drop parts that are not valid for the message type.
	 * LanguageModelToolResultPart: only on User messages
	 * LanguageModelToolCallPart: only on Assistant messages
	 */
	content2: (string | LanguageModelToolResultPart | LanguageModelToolCallPart)[];
}

// Tool registration/invoking between extensions

/**
 * A result returned from a tool invocation.
 */
// TODO@API should we align this with NotebookCellOutput and NotebookCellOutputItem
export interface LanguageModelToolResult {
	/**
	 * The result can contain arbitrary representations of the content. A tool user can set
	 * {@link LanguageModelToolInvocationOptions.requested} to request particular types, and a tool implementation should only
	 * compute the types that were requested. `text/plain` is recommended to be supported by all tools, which would indicate
	 * any text-based content. Another example might be a `PromptElementJSON` from `@vscode/prompt-tsx`, using the
	 * `contentType` exported by that library.
	 */
	[contentType: string]: any;
}

export namespace lm {
	/**
	 * Register a LanguageModelTool. The tool must also be registered in the package.json `languageModelTools` contribution
	 * point. A registered tool is available in the {@link lm.tools} list for any extension to see. But in order for it to
	 * be seen by a language model, it must be passed in the list of available tools in {@link LanguageModelChatRequestOptions.tools}.
	 */
	export function registerTool<T>(id: string, tool: LanguageModelTool<T>): Disposable;

	/**
	 * A list of all available tools.
	 */
	export const tools: ReadonlyArray<LanguageModelToolDescription>;

	/**
	 * Invoke a tool with the given parameters.
	 */
	export function invokeTool<T>(id: string, options: LanguageModelToolInvocationOptions<T>, token: CancellationToken): Thenable<LanguageModelToolResult>;
}

/**
 * A token that can be passed to {@link lm.invokeTool} when invoking a tool inside the context of handling a chat request.
 */
export type ChatParticipantToolToken = unknown;

/**
 * Options provided for tool invocation.
 */
export interface LanguageModelToolInvocationOptions<T> {
	/**
	 * When this tool is being invoked within the context of a chat request, this token should be passed from
	 * {@link ChatRequest.toolInvocationToken}. In that case, a progress bar will be automatically shown for the tool
	 * invocation in the chat response view, and if the tool requires user confirmation, it will show up inline in the chat
	 * view. If the tool is being invoked outside of a chat request, `undefined` should be passed instead.
	 */
	toolInvocationToken: ChatParticipantToolToken | undefined;

	/**
	 * The parameters with which to invoke the tool. The parameters must match the schema defined in
	 * {@link LanguageModelToolDescription.parametersSchema}
	 */
	parameters: T;

	/**
	 * A tool user can request that particular content types be returned from the tool, depending on what the tool user
	 * supports. All tools are recommended to support `text/plain`. See {@link LanguageModelToolResult}.
	 */
	requestedContentTypes: string[];

	/**
	 * Options to hint at how many tokens the tool should return in its response.
	 */
	tokenOptions?: {
		/**
		 * If known, the maximum number of tokens the tool should emit in its result.
		 */
		tokenBudget: number;

		/**
		 * Count the number of tokens in a message using the model specific tokenizer-logic.
		 * @param text A string.
		 * @param token Optional cancellation token.  See {@link CancellationTokenSource} for how to create one.
		 * @returns A thenable that resolves to the number of tokens.
		 */
		countTokens(text: string, token?: CancellationToken): Thenable<number>;
	};
}

/**
 * Represents a JSON Schema.
 * TODO@API - is this worth it?
 */
export type JSONSchema = Object;

/**
 * A description of an available tool.
 */
export interface LanguageModelToolDescription {
	/**
	 * A unique identifier for the tool.
	 */
	readonly id: string;

	/**
	 * A human-readable name for this tool that may be used to describe it in the UI.
	 * TODO@API keep?
	 */
	readonly displayName: string | undefined;

	/**
	 * A description of this tool that may be passed to a language model.
	 */
	readonly description: string;

	/**
	 * A JSON schema for the parameters this tool accepts.
	 */
	readonly parametersSchema?: JSONSchema;

	/**
	 * The list of content types that the tool has declared support for. See {@link LanguageModelToolResult}.
	 */
	readonly supportedContentTypes: string[];

	/**
	 * A set of tags, declared by the tool, that roughly describe the tool's capabilities. A tool user may use these to filter
	 * the set of tools to just ones that are relevant for the task at hand.
	 */
	readonly tags: string[];
}

/**
 * Messages shown in the chat view when a tool needs confirmation from the user to run. These messages will be shown with
 * buttons that say Continue and Cancel.
 */
export interface LanguageModelToolConfirmationMessages {
	/**
	 * The title of the confirmation message.
	 */
	title: string;

	/**
	 * The body of the confirmation message. This should be phrased as an action of the participant that is invoking the tool
	 * from {@link LanguageModelToolInvocationPrepareOptions.participantName}. An example of a good message would be
	 * `${participantName} will run the command ${echo 'hello world'} in the terminal.`
	 * TODO@API keep this?
	 */
	message: string | MarkdownString;
}

/**
 * Options for {@link LanguageModelTool.prepareToolInvocation}.
 */
export interface LanguageModelToolInvocationPrepareOptions<T> {
	/**
	 * The name of the participant invoking the tool.
	 * TODO@API keep this?
	 */
	participantName: string;

	/**
	 * The parameters that the tool is being invoked with.
	 */
	parameters: T;
}

/**
 * A tool that can be invoked by a call to a {@link LanguageModelChat}.
 */
export interface LanguageModelTool<T> {
	/**
	 * Invoke the tool with the given parameters and return a result.
	 */
	invoke(options: LanguageModelToolInvocationOptions<T>, token: CancellationToken): ProviderResult<LanguageModelToolResult>;

	/**
	 * Called once before a tool is invoked. May be implemented to customize the progress message that appears while the tool
	 * is running, and the messages that appear when the tool needs confirmation.
	 */
	prepareToolInvocation?(options: LanguageModelToolInvocationPrepareOptions<T>, token: CancellationToken): ProviderResult<PreparedToolInvocation>;
}

/**
 * The result of a call to {@link LanguageModelTool.prepareToolInvocation}.
 */
export interface PreparedToolInvocation {
	/**
	 * A customized progress message to show while the tool runs.
	 */
	invocationMessage?: string;

	/**
	 * Customized messages to show when asking for user confirmation to run the tool.
	 */
	confirmationMessages?: LanguageModelToolConfirmationMessages;
}

/**
 * A reference to a tool attached to a user's request.
 */
export interface ChatLanguageModelToolReference {
	/**
	 * The tool's ID. Refers to a tool listed in {@link lm.tools}.
	 */
	readonly id: string;

	/**
	 * The start and end index of the reference in the {@link ChatRequest.prompt prompt}. When undefined, the reference was
	 * not part of the prompt text.
	 *
	 * *Note* that the indices take the leading `#`-character into account which means they can be used to modify the prompt
	 * as-is.
	 */
	readonly range?: [start: number, end: number];
}

export interface ChatRequest {
	/**
	 * The list of tools that the user attached to their request.
	 *
	 * *Note* that if tools are referenced in the text of the prompt, using `#`, the prompt contains references as authored
	 * and it is up to the participant to further modify the prompt, for instance by inlining reference values or
	 * creating links to headings which contain the resolved values. References are sorted in reverse by their range in the
	 * prompt. That means the last reference in the prompt is the first in this list. This simplifies string-manipulation of
	 * the prompt.
	 */
	readonly toolReferences: readonly ChatLanguageModelToolReference[];

	/**
	 * A token that can be passed to {@link lm.invokeTool} when invoking a tool inside the context of handling a chat request.
	 */
	readonly toolInvocationToken: ChatParticipantToolToken;
}

export interface ChatRequestTurn {
	/**
	 * The list of tools were attached to this request.
	 */
	readonly toolReferences?: readonly ChatLanguageModelToolReference[];
}