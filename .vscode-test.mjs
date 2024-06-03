import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'dist/base/test/*.test.js',
	version: 'insiders',
	launchArgs: ['--disable-extensions', '--profile-temp'],
	mocha: {
		ui: 'tdd',
		color: true,
		forbidOnly: !!process.env.CI,
		timeout: 5000,
	},
});
