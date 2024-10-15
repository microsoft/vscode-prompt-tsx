/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { copyStaticAssets } from './postinstall';

async function main() {
	// Ship the vscodeTypes.d.ts file in the dist bundle
	await copyStaticAssets(['src/base/vscodeTypes.d.ts'], 'dist/base/');
}

main();
