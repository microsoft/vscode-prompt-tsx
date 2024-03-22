const { build } = require('esbuild')
const { dependencies, peerDependencies } = require('../package.json')
const { Generator } = require('npm-dts')

// Generate bundle
build({
  entryPoints: ['src/base/index.ts'],
  outdir: 'dist',
  bundle: true,
  minify: true,
  platform: 'node',
  external: Object.keys(dependencies),
})

// Generate index.d.ts
new Generator({
  entry: 'src/base/index.ts',
  output: 'dist/index.d.ts',
}).generate()
