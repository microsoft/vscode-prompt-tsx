import * as assert from 'assert';
import * as chokidar from 'chokidar';
import * as esbuild from 'esbuild';
import { writeFileSync } from 'fs';

const watch = process.argv.includes('--watch');
const minify = watch ? process.argv.includes('--minify') : !process.argv.includes('--no-minify');

const ctx = esbuild.context({
	entryPoints: ['src/tracer/index.tsx'],
	tsconfig: 'src/tracer/tsconfig.json',
	bundle: true,
	sourcemap: minify ? false : 'inline',
	minify,
	platform: 'browser',
	outdir: 'out',
	write: false,
});

function build() {
	return ctx
		.then(ctx => ctx.rebuild())
		.then(bundle => {
			assert.strictEqual(bundle.outputFiles.length, 2, 'expected to have 2 output files');

			const css = bundle.outputFiles.find(o => o.path.endsWith('.css'));
			assert.ok(css, 'expected to have css');
			const js = bundle.outputFiles.find(o => o.path.endsWith('.js'));
			assert.ok(js, 'expected to have js');
			writeFileSync(
				'src/base/htmlTracerSrc.ts',
				`export const tracerSrc = ${JSON.stringify(
					js.text
				)};\nexport const tracerCss = ${JSON.stringify(css.text)};`
			);
		})
		.catch(err => {
			if (err.errors) {
				console.error(err.errors.join('\n'));
			} else {
				console.error(err);
			}
		});
}

if (watch) {
	let timeout: NodeJS.Timeout | null = null;
	chokidar.watch('src/tracer/**/*.{tsx,ts,css}', {}).on('all', () => {
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(build, 600);
	});
} else {
	build().then(() => {
		process.exit(0);
	});
}
