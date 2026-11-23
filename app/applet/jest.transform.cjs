const esbuild = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    const result = esbuild.transformSync(sourceText, {
      loader: sourcePath.endsWith('.tsx') ? 'tsx' : 'ts',
      target: 'es2022',
      format: 'cjs',
    });
    return {
      code: result.code,
    };
  },
};
