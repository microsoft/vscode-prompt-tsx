/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { PromptMetadata, PromptReference } from './results';
import { URI } from './util/vs/common/uri';
import { ChatDocumentContext } from './vscodeTypes';

declare global {
	namespace JSX {
		interface IntrinsicElements {
			/**
			 * Add meta data which can be retrieved after the prompt is rendered.
			 */
			"meta": {
				value: PromptMetadata;
			};
			/**
			 * `\n` character.
			 */
			"br": {};
			/**
			 * Expose context used for creating the prompt.
			 */
			"usedContext": {
				value: ChatDocumentContext[];
			};
			/**
			 * Expose the references used for creating the prompt.
			 * Will be displayed to the user.
			 */
			"references": {
				value: PromptReference[];
			};
			/**
			 * Files that were excluded from the prompt.
			 */
			"ignoredFiles": {
				value: URI[];
			};
		}
	}
}
