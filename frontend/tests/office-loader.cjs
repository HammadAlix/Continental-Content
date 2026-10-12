/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node test loader. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

module.exports = function createLoader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(__dirname, '../src', file);
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const resolve = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'server-only') return {};
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      return require(name);
    };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', source)(resolve, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
};
