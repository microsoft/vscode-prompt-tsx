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
			 * A data object that is emitted directly in the output. You as the
			 * consumer are responsible for ensuring this data works. This element
			 * has SHARP EDGES and should be used with great care.
			 */
			opaque: {
				/** Value to be inserted in the output */
				value: unknown;
				/**
				 * The number of tokens consumed by this fragment. This must be AT
				 * LEAST the number of tokens this part represents in your tokenizer's
				 * `countMessageTokens` method, or you will get obscure errors.
				 */
				tokenUsage?: number;
				/** Usual priority value. */
				priority?: number;
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
