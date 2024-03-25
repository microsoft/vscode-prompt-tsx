/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..');

export async function copyStaticAssets(srcpaths: string[], dst: string): Promise<void> {
	await Promise.all(srcpaths.map(async srcpath => {
		const src = path.join(REPO_ROOT, srcpath);
		const dest = path.join(REPO_ROOT, dst, path.basename(srcpath));
		await fs.promises.mkdir(path.dirname(dest), { recursive: true });
		await fs.promises.copyFile(src, dest);
	}));
}

async function main() {
	// Ship the tiktoken file in the dist bundle
	await copyStaticAssets([
		'src/base/tokenizer/cl100k_base.tiktoken',
	], 'dist/base/tokenizer');
}

main();
