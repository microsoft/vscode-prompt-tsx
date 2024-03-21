/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

interface _InternalPromptPiece<P = any> {
	ctor: string | any;
	props: P;
	children: string | (_InternalPromptPiece<any> | undefined)[];
}

/**
 * Visual Studio Code Prompt Piece
 */
function _vscpp(ctor: any, props: any, ...children: any[]): _InternalPromptPiece {
	return { ctor, props, children: children.flat() };
}

/**
 * Visual Studio Code Prompt Piece Fragment
 */
function _vscppf() {
	throw new Error(`This should not be invoked!`);
}
_vscppf.isFragment = true;

declare const vscpp: typeof _vscpp;
declare const vscppf: typeof _vscppf;

(<any>globalThis).vscpp = _vscpp;
(<any>globalThis).vscppf = _vscppf;
