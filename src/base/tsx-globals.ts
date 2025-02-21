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
			 * An opaque object added to the response. This is spliced directly into
			 * the `content` of resulting chat messages.
			 *
			 * This is back-door you can use to extend existing TSX functionality and
			 * experiment with new features. **You** are responsible for ensuring
			 * this is compatible with your model's API types. Note all
			 * output formats allow opaque data in all message types.
			 */
			opaque: {
				value: unknown;
				metadata: unknown;
			};
		}
	}
}
