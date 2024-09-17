/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Handler that can trace rendering internals.
 */
export interface ITracer {
	/** starts a pass of rendering multiple elements */
	startRenderPass(): void;
	/** starts rendering a flex group */
	startRenderFlex(group: number, reserved: number, remainingTokenBudget: number): void;
	/** Marks that an element was rendered. May be followed by `startRenderPass` for children */
	didRenderElement(name: string, literals: string[]): void;
	/** Marks that an element's children were rendered and consumed that many tokens */
	didRenderChildren(tokensConsumed: number): void;
	/** ends rendering a flex group */
	endRenderFlex(): void;
	/** ends a previously started render pass */
	endRenderPass(): void;
}
