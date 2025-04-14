import { existsSync, readFileSync } from 'fs';
import { Bench } from 'tinybench';
import { Cl100KBaseTokenizer } from '../tokenizer/cl100kBaseTokenizer';
import type * as promptTsx from '..';
import assert = require('assert');

const comparePathVar = 'PROMPT_TSX_COMPARE_PATH';
const tsxComparePath =
	process.env[comparePathVar] ||
	`${__dirname}/../../../../vscode-copilot/node_modules/@vscode/prompt-tsx`;
const canCompare = existsSync(tsxComparePath);
if (!canCompare) {
	console.error(
		`$${comparePathVar} was not set / ${tsxComparePath} doesn't exist, so the benchmark will not compare to past behavior`
	);
	process.exit(1);
}

const numberOfRepeats = 1;
const sampleText = readFileSync(`${__dirname}/renderer.test.tsx`, 'utf-8');
const sampleTextLines = readFileSync(`${__dirname}/renderer.test.tsx`, 'utf-8').split('\n');
const tokenizer = new Cl100KBaseTokenizer();
const bench = new Bench({
	name: `trim ${tokenizer.tokenLength({ type: 1, text: sampleText }) * numberOfRepeats}->1k tokens`,
	time: 100,
});

async function benchTokenizationTrim({
	PromptRenderer,
	PromptElement,
	UserMessage,
	TextChunk,
}: typeof promptTsx) {
	const r = await new PromptRenderer(
		{ modelMaxPromptTokens: 1000 },
		class extends PromptElement {
			render() {
				return (
					<>
						{Array.from({ length: numberOfRepeats }, () => (
							<UserMessage>
								{sampleTextLines.map(l => (
									<TextChunk>{l}</TextChunk>
								))}
							</UserMessage>
						))}
					</>
				);
			}
		},
		{},
		tokenizer
	).render();
	assert(r.tokenCount <= 1000);
	assert(r.tokenCount > 100);
}

bench.add('current', () => benchTokenizationTrim(require('..')));
if (canCompare) {
	const fn = require(tsxComparePath);
	bench.add('previous', () => benchTokenizationTrim(fn));
}

bench.run().then(() => {
	console.log(bench.name);
	console.table(bench.table());
});
