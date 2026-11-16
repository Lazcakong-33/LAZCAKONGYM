const esbuild = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    const loader = sourcePath.endsWith('.tsx')
      ? 'tsx'
      : sourcePath.endsWith('.ts')
      ? 'ts'
      : 'js';
    const result = esbuild.transformSync(sourceText, {
      loader,
      format: 'cjs',
      target: 'node20',
      sourcemap: 'inline',
      sourcefile: sourcePath,
    });
    return {
      code: result.code,
      map: result.map,
    };
  },
};
