const resolve = require('rollup-plugin-node-resolve');
const vue = require('rollup-plugin-vue');
const json = require('rollup-plugin-json');
const babel = require('rollup-plugin-babel');
const postcss = require('rollup-plugin-postcss');
const commonjs = require('rollup-plugin-commonjs');
const { terser } = require('rollup-plugin-terser');
const image = require('rollup-plugin-img');

const plugin = require('./plugins');

module.exports = function (fileName, destPath, filePath) {
  process.env.VUE_ENV = undefined;
  const vuePlugin = vue({
    needMap: false
  });

  // const originalVueTransform = vuePlugin.transform;
  // vuePlugin.transform = async function (source, filename) {
  //   if (source.includes('//do_nothing;\n')) return source.replace('//do_nothing;\n', '');
  //   return originalVueTransform(source, filename);
  // }

  return {
    input: `${filePath}`,
    output: {
      name: `${fileName.slice(0, -4)}`,
      file: destPath,
      format: 'cjs'
    },
    plugins: [
      resolve({
        extensions: ['.mjs', '.js', '.vue', '.json']
      }),
      image({
        limit: 500000,
      }),
      postcss({
        extract: false,
        modules: true,
        use: ['sass']
      }),
      //plugin(),
      vuePlugin,
      babel({
        babelrc: false,
        presets: ['vca-jsx', ['@vue/jsx',
          {
            'useBuiltIns': 'entry'
          }]],
        plugins: ['@babel/plugin-syntax-import-meta',
          '@babel/plugin-syntax-dynamic-import'],
        runtimeHelpers: true
      }),
      commonjs(),
      json(),
      terser()
    ],
    external: ['json-fn', 'cms', 'MonacoEditor', 'lodash', 'dayjs', 'axios',
      'pos-vue-framework', 'vue', 'vue-the-mask', 'vue-fragment', 'vue-runtime-helpers', '@vue/composition-api', 'snackbarController']
  }
};
