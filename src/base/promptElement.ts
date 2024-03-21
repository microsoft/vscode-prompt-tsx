/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Progress } from 'vscode';
import './tsx';
import { BasePromptElementProps, PromptElementProps, PromptPiece, PromptSizing } from "./types";
import { ChatResponsePart } from './vscodeTypes';

/**
 * `PromptElement` represents a single element of a prompt.
 * A prompt element can be rendered by the {@link PromptRenderer} to produce {@link ChatMessage} chat messages.
 *
 * @remarks Newlines are not preserved in string literals when rendered, and must be explicitly declared with the builtin `<br />` attribute.
 *
 * @template P - The type of the properties for the prompt element. It extends `BasePromptElementProps`.
 * @template S - The type of the state for the prompt element. It defaults to `void`.
 *
 * @property props - The properties of the prompt element.
 * @property priority - The priority of the prompt element. If not provided, defaults to 0.
 *
 * @method prepare - Optionally prepares asynchronous state before the prompt element is rendered.
 * @method render - Renders the prompt element. This method is abstract and must be implemented by subclasses.
 */
export abstract class PromptElement<P extends BasePromptElementProps = BasePromptElementProps, S = void> {

	public readonly props: PromptElementProps<P>;

	get priority(): number {
		return this.props.priority ?? 0;
	}

	constructor(props: PromptElementProps<P>) {
		this.props = props;
	}

	/**
	 * Optionally prepare asynchronous state before the prompt element is rendered.
	 * @param progress - Optionally report progress to the user for long-running state preparation.
	 * @param token - A cancellation token that can be used to signal cancellation to the prompt element.
	 *
	 * @returns A promise that resolves to the prompt element's state.
	 */
	prepare?(sizing: PromptSizing, progress?: Progress<ChatResponsePart>, token?: CancellationToken): Promise<S>;

	/**
	 * Renders the prompt element.
	 *
	 * @param state - The state of the prompt element.
	 * @param sizing - The sizing information for the prompt.
	 * @returns The rendered prompt piece or undefined if the element does not want to render anything.
	 */
	abstract render(state: S, sizing: PromptSizing): PromptPiece | undefined;
}
