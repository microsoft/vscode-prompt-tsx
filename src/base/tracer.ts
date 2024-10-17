/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { MaterializedContainer } from './materialized';
import { ITokenizer } from './tokenizer/tokenizer';

export interface ITraceRenderData {
	budget: number;
	container: MaterializedContainer;
	removed: number;
}

export interface ITraceData {
	/** Budget the tree was rendered with initially. */
	budget: number;

	/** Tree returned from the prompt. */
	renderedTree: ITraceRenderData;

	/** Tokenizer that was used. */
	tokenizer: ITokenizer;

	/** Callback the tracer and use to re-render the tree at the given budget. */
	renderTree(tokenBudget: number): Promise<ITraceRenderData>;
}

export interface IElementEpochData {
	id: number;
	tokenBudget: number;
}

export interface ITraceEpoch {
	inNode: number | undefined;
	flexValue: number;
	tokenBudget: number;
	reservedTokens: number;
	elements: IElementEpochData[];
}

/**
 * Handler that can trace rendering internals.
 */
export interface ITracer {
	/**
	 * Called when a group of elements is rendered.
	 */
	addRenderEpoch?(epoch: ITraceEpoch): void;

	/**
	 * Adds an element into the current epoch.
	 */
	includeInEpoch?(data: IElementEpochData): void;

	/**
	 * Called when the elements have been processed into their final tree form.
	 */
	didMaterializeTree?(traceData: ITraceData): void;
}
