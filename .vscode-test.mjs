import { defineConfig } from '@vscode/test-cli';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
	files: __dirname + '/dist/base/test/renderer.test.js',
	version: 'insiders',
	launchArgs: ['--disable-extensions', '--profile-temp'],
	mocha: {
		ui: 'tdd',
		color: true,
		forbidOnly: !!process.env.CI,
		timeout: 5000,
	},
});
