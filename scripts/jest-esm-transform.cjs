const esbuild = require('esbuild');
module.exports = { process(source, file) { return { code: esbuild.transformSync(source, { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', target: 'es2022', format: 'esm', sourcemap: 'inline' }).code }; } };
