/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { copyStaticAssets } from './postinstall';

const REPO_ROOT = path.join(__dirname, '..');

async function main() {
	// Ship the tiktoken file in the dist bundle
	await copyStaticAssets([
		'src/base/index.d.ts',
		'src/base/vscodeTypes.d.ts',
	], 'dist/base/');
}

main();
