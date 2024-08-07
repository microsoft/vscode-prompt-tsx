/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode';
import { PromptElement } from "./promptElement";

/**
 * Represents information about a chat endpoint.
 */
export interface IChatEndpointInfo {
	/**
	 * The maximum number of tokens allowed in the model prompt.
	 */
	readonly modelMaxPromptTokens: number;
}

/**
 * The sizing hint for the prompt element. Prompt elements should take this into account when rendering.
 */
export interface PromptContext {
	/**
	 * The computed token allocation for this prompt element to adhere to when rendering,
	 * if it specified {@link BasePromptElementProps.flexBasis}.
	 */
	readonly tokenBudget: number;
	/**
	 * Metadata about the endpoint being used.
	 */
	readonly endpoint: IChatEndpointInfo;

	/**
	 * Counts the number of tokens the text consumes.
	 */
	countTokens(text: string, token?: CancellationToken): Promise<number> | number;
}

export interface BasePromptElementProps {
	/**
	 * The absolute priority of the prompt element.
	 *
	 * If the messages to be sent exceed the available token budget, prompt elements will be removed from the rendered result, starting with the element with the lowest priority.
	 */
	priority?: number;
	/**
	 * The proportion of the container's {@link PromptContext.tokenBudget token budget} that is assigned to this prompt element, based on the total weight requested by the prompt element and all its siblings.
	 *
	 * This is used to compute the {@link PromptContext.tokenBudget token budget} hint that the prompt element receives.
	 *
	 * If set on a child element, the token budget is calculated with respect to all children under the element's parent, such that a child can never consume more tokens than its parent was allocated.
	 *
	 * Defaults to 1.
	 */
	flexBasis?: number;

	/** @deprecated renamed to {@link flexBasis} */
	flex?: number;

	/**
	 * If set, sibling elements will be rendered first, followed by this element. The remaining {@link PromptContext.tokenBudget token budget} from the container will be distributed among the elements with `flexGrow` set.
	 *
	 * If multiple elements are present with different values of `flexGrow` set, this process is repeated for each value of `flexGrow` in descending order.
	 */
	flexGrow?: number;

	/**
	 * If set with {@link flexGrow}, this defines the number of tokens this element will reserve of the container {@link PromptContext.tokenBudget token budget} for sizing purposes in elements rendered before it.
	 */
	flexReserve?: number;
}

export interface PromptElementCtor<P extends BasePromptElementProps, S> {
	isFragment?: boolean;
	new(props: P, ...args: any[]): PromptElement<P, S>;
}

export interface RuntimePromptElementProps {
	children?: PromptPiece[];
}

export type PromptElementProps<T> = T & BasePromptElementProps & RuntimePromptElementProps;

export interface PromptPiece<P extends BasePromptElementProps = any, S = any> {
	ctor: string | PromptElementCtor<P, S>;
	props: P;
	children: PromptPieceChild[];
}

export type PromptPieceChild = number | string | PromptPiece<any> | undefined;

/**
 * A part of a prompt element returned from {@link LanguageModelPromptElement.render}.
 * This is most easily formed by rendering a JSX element, see more documentation
 * at <link>
 */
export interface LanguageModelPromptPiece {
	ctor: string | { new(props: any, ...args: any[]): LanguageModelPromptElement };
	props: any;
	children: (number | string | LanguageModelPromptPiece | undefined)[];
}

/**
 * A prompt element that can be rendered by an extension for a language model.
 */
export interface LanguageModelPromptElement {
	/**
	 * Identifies that the data is a prompt element for consumers.
	 */
	readonly isLanguageModelPromptElement: true;

	/**
	 * Renders the prompt element.
	 *
	* @param state - The state of the prompt element.
	* @param sizing - The sizing information for the prompt.
	* @returns The rendered prompt piece
		*/
	render(sizing: PromptContext, token: CancellationToken): Thenable<LanguageModelPromptPiece | undefined> | LanguageModelPromptPiece | undefined;
}

// check assignability:
declare const myElement: PromptElement;
const foo: LanguageModelPromptElement = myElement;
