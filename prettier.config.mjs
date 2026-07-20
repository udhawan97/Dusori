export default {
  plugins: ['prettier-plugin-svelte', 'prettier-plugin-astro'],
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  overrides: [
    { files: '*.svelte', options: { parser: 'svelte' } },
    { files: '*.astro', options: { parser: 'astro' } },
  ],
};
