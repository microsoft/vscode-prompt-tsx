/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { PromptElementJSON } from './jsonTypes';
import { PromptMetadata, PromptReference } from './results';
import { URI } from './util/vs/common/uri';
import { ChatDocumentContext } from './vscodeTypes';

declare global {
	namespace JSX {
		interface IntrinsicElements {
			/**
			 * Add meta data which can be retrieved after the prompt is rendered.
			 */
			meta: {
				value: PromptMetadata;
				/**
				 * If set, the metadata will only be included in the rendered result
				 * if the chunk it's in survives prioritization.
				 */
				local?: boolean;
			};
			/**
			 * `\n` character.
			 */
			br: {};
			/**
			 * Expose context used for creating the prompt.
			 */
			usedContext: {
				value: ChatDocumentContext[];
			};
			/**
			 * Expose the references used for creating the prompt.
			 * Will be displayed to the user.
			 */
			references: {
				value: PromptReference[];
			};
			/**
			 * Files that were excluded from the prompt.
			 */
			ignoredFiles: {
				value: URI[];
			};
			/**
			 * A JSON element previously rendered in {@link renderElementJSON}.
			 */
			elementJSON: {
				data: PromptElementJSON;
			};

			/**
			 * Adds a 'cache breakpoint' to the output. This is exclusively valid
			 * as a direct child of message types (UserMessage, SystemMessage, etc.)
			 */
			cacheBreakpoint: {
				/** Optional implementation-specific cache type */
				type?: string;
			};
		}
	}
}
