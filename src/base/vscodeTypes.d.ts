/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	CancellationToken,
	Command,
	Location,
	MarkdownString,
	ProviderResult,
	Range,
	ThemeIcon,
	Uri,
} from 'vscode';

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
	iconPath?:
		| Uri
		| ThemeIcon
		| {
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
	constructor(
		value: Uri | Location,
		iconPath?:
			| Uri
			| ThemeIcon
			| {
				/**
				 * The icon path for the light theme.
				 */
				light: Uri;
				/**
				 * The icon path for the dark theme.
				 */
				dark: Uri;
			}
	);
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
export type ChatResponsePart =
	| ChatResponseMarkdownPart
	| ChatResponseFileTreePart
	| ChatResponseAnchorPart
	| ChatResponseProgressPart
	| ChatResponseReferencePart
	| ChatResponseCommandButtonPart;

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
	sendRequest(
		messages: LanguageModelChatMessage[],
		options?: LanguageModelChatRequestOptions,
		token?: CancellationToken
	): Thenable<LanguageModelChatResponse>;

	/**
	 * Count the number of tokens in a message using the model specific tokenizer-logic.

	 * @param text A string or a message instance.
	 * @param token Optional cancellation token.  See {@link CancellationTokenSource} for how to create one.
	 * @returns A thenable that resolves to the number of tokens.
	 */
	countTokens(text: string | LanguageModelChatMessage, token?: CancellationToken): Thenable<number>;
}


/**
 * A tool that is available to the language model via {@link LanguageModelChatRequestOptions}. A language model uses all the
 * properties of this interface to decide which tool to call, and how to call it.
 */
export interface LanguageModelChatTool {
	/**
	 * The name of the tool.
	 */
	name: string;

	/**
	 * The description of the tool.
	 */
	description: string;

	/**
	 * A JSON schema for the parameters this tool accepts.
	 */
	parametersSchema?: object;
}

export enum LanguageModelChatToolMode {
	/**
	 * The language model can choose to call a tool or generate a message. The default.
	 */
	Auto = 1,

	/**
	 * The language model must call one of the provided tools. An extension can force a particular tool to be used by using the
	 * Required mode and only providing that one tool.
	 * TODO@API 'required' is not supported by CAPI
	 * The LM provider can throw if more than one tool is provided. But this mode is supported by different models and it makes sense
	 * to represent it in the API. We can note the limitation here.
	 */
	Required = 2
}

export interface LanguageModelChatRequestOptions {

	/**
	 * An optional list of tools that are available to the language model. These could be registered tools available via
	 * {@link lm.tools}, or private tools that are just implemented within the calling extension.
	 *
	 * If the LLM requests to call one of these tools, it will return a {@link LanguageModelToolCallPart} in
	 * {@link LanguageModelChatResponse.stream}. It's the caller's responsibility to invoke the tool. If it's a tool
	 * registered in {@link lm.tools}, that means calling {@link lm.invokeTool}.
	 *
	 * Then, the tool result can be provided to the LLM by creating an Assistant-type {@link LanguageModelChatMessage} with a
	 * {@link LanguageModelToolCallPart}, followed by a User-type message with a {@link LanguageModelToolResultPart}.
	 */
	tools?: LanguageModelChatTool[];

	/**
	 * 	The tool calling mode to use. {@link LanguageModelChatToolMode.Auto} by default.
	 */
	toolMode?: LanguageModelChatToolMode;
}

/**
 * A language model response part indicating a tool call, returned from a {@link LanguageModelChatResponse}, and also can be
 * included as a content part on a {@link LanguageModelChatMessage}, to represent a previous tool call in a chat request.
 */
export class LanguageModelToolCallPart {
	/**
	 * The name of the tool to call.
	 */
	name: string;

	/**
	 * The ID of the tool call. This is a unique identifier for the tool call within the chat request.
	 */
	callId: string;

	/**
	 * The parameters with which to call the tool.
	 */
	parameters: object;

	/**
	 * Create a new LanguageModelToolCallPart.
	 */
	constructor(name: string, callId: string, parameters: object);
}

/**
 * A language model response part containing a piece of text, returned from a {@link LanguageModelChatResponse}.
 */
export class LanguageModelTextPart {
	/**
	 * The text content of the part.
	 */
	value: string;

	constructor(value: string);
}

/**
 * A language model response part containing a PromptElementJSON from `@vscode/prompt-tsx`.
 */
export class LanguageModelPromptTsxPart {
	/**
	 * The content of the part.
	 */
	value: unknown;

	/**
	 * The mimeType of this part, exported from the `@vscode/prompt-tsx` library.
	 */
	mime: string;

	// TODO@API needs the version number/mimeType from prompt-tsx?
	constructor(value: unknown, mime: string);
}

export interface LanguageModelChatResponse {
	/**
	 * A stream of parts that make up the response. Could be extended with more types in the future.
	 */
	stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown>;
}

/**
 * The result of a tool call. Can only be included in the content of a User message.
 */
export class LanguageModelToolResultPart {
	/**
	 * The ID of the tool call.
	 */
	callId: string;

	/**
	 * The value of the tool result.
	 */
	content: (LanguageModelTextPart | LanguageModelPromptTsxPart | unknown)[];

	constructor(callId: string, content: (LanguageModelTextPart | LanguageModelPromptTsxPart | unknown)[]);
}

export interface LanguageModelChatMessage {
	/**
	 * A heterogeneous array of other things that a message can contain as content. Some parts may be message-type specific
	 * for some models.
	 */
	content2: (string | LanguageModelToolResultPart | LanguageModelToolCallPart)[];
}

/**
 * A result returned from a tool invocation.
 */
export class LanguageModelToolResult {
	content: (LanguageModelTextPart | LanguageModelPromptTsxPart | unknown)[];

	constructor(content: (LanguageModelTextPart | LanguageModelPromptTsxPart | unknown)[]);
}

export namespace lm {
	/**
	 * Register a LanguageModelTool. The tool must also be registered in the package.json `languageModelTools` contribution
	 * point. A registered tool is available in the {@link lm.tools} list for any extension to see. But in order for it to
	 * be seen by a language model, it must be passed in the list of available tools in {@link LanguageModelChatRequestOptions.tools}.
	 */
	export function registerTool<T>(name: string, tool: LanguageModelTool<T>): Disposable;

	/**
	 * A list of all available tools.
	 */
	export const tools: readonly LanguageModelToolInformation[];

	/**
	 * Invoke a tool with the given parameters.
	 * TODO describe content types and token options here
	 */
	export function invokeTool(name: string, options: LanguageModelToolInvocationOptions<object>, token: CancellationToken): Thenable<LanguageModelToolResult>;
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
	 *
	 * If a tool invokes another tool during its invocation, it can pass along the `toolInvocationToken` that it received.
	 */
	toolInvocationToken: ChatParticipantToolToken | undefined;

	/**
	 * The parameters with which to invoke the tool. The parameters must match the schema defined in
	 * {@link LanguageModelToolInformation.parametersSchema}
	 */
	parameters: T;

	/**
	 * A tool can return multiple types of content. A tool user must specifically request one or more types of content to be
	 * returned, based on what the tool user supports. The typical type is `text/plain` to return string-type content, and all
	 * tools are recommended to support `text/plain`. See {@link LanguageModelToolResult} for more.
	 * TODO@API delete
	 */
	requestedMimeTypes: string[];

	/**
	 * Options to hint at how many tokens the tool should return in its response, and enable the tool to count tokens
	 * accurately.
	 */
	tokenizationOptions?: LanguageModelToolTokenizationOptions;
}

export interface LanguageModelToolTokenizationOptions {
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
}

/**
 * Information about a registered tool available in {@link lm.tools}.
 */
export interface LanguageModelToolInformation {
	/**
	 * A unique name for the tool.
	 */
	readonly name: string;

	/**
	 * A description of this tool that may be passed to a language model.
	 */
	readonly description: string;

	/**
	 * A JSON schema for the parameters this tool accepts.
	 */
	readonly parametersSchema: object | undefined;

	/**
	 * The list of mime types that the tool is able to return as a result. See {@link LanguageModelToolResult}.
	 * TODO@API delete
	 */
	readonly supportedResultMimeTypes: readonly string[];

	/**
	 * A set of tags, declared by the tool, that roughly describe the tool's capabilities. A tool user may use these to filter
	 * the set of tools to just ones that are relevant for the task at hand.
	 */
	readonly tags: readonly string[];
}

/**
 * When this is returned in {@link PreparedToolInvocation}, the user will be asked to confirm before running the tool. These
 * messages will be shown with buttons that say "Continue" and "Cancel".
 */
export interface LanguageModelToolConfirmationMessages {
	/**
	 * The title of the confirmation message.
	 */
	title: string;

	/**
	 * The body of the confirmation message.
	 */
	message: string | MarkdownString;
}

/**
 * Options for {@link LanguageModelTool.prepareInvocation}.
 */
export interface LanguageModelToolInvocationPrepareOptions<T> {
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
	 *
	 * The provided {@link LanguageModelToolInvocationOptions.parameters} have been validated against the schema declared for
	 * this tool.
	 */
	invoke(options: LanguageModelToolInvocationOptions<T>, token: CancellationToken): ProviderResult<LanguageModelToolResult>;

	/**
	 * Called once before a tool is invoked. May be implemented to signal that a tool needs user confirmation before running,
	 * and to customize the progress message that appears while the tool is running. Must be free of side-effects. A call to
	 * `prepareInvocation` is not necessarily followed by a call to `invoke`.
	 */
	prepareInvocation?(options: LanguageModelToolInvocationPrepareOptions<T>, token: CancellationToken): ProviderResult<PreparedToolInvocation>;
}

/**
 * The result of a call to {@link LanguageModelTool.prepareInvocation}.
 */
export interface PreparedToolInvocation {
	/**
	 * A customized progress message to show while the tool runs.
	 */
	invocationMessage?: string;

	/**
	 * The presence of this property indicates that the user should be asked to confirm before running the tool.
	 */
	confirmationMessages?: LanguageModelToolConfirmationMessages;
}

/**
 * A reference to a tool attached to a user's request.
 */
export interface ChatLanguageModelToolReference {
	/**
	 * The tool name. Refers to a tool listed in {@link lm.tools}.
	 */
	readonly name: string;

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
