import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  css: { postcss: { plugins: [{
    postcssPlugin: 'micro-bi-preset-global-scope',
    Rule(rule: any) {
      const file = String(rule.source?.input?.file || '').replace(/\\/g, '/');
      if (!file.includes('/@univerjs/preset-sheets-core/')) return;
      const scope = ':where([data-micro-bi-root], [data-micro-bi-root] *, [class*="univer-"])';
      rule.selectors = rule.selectors.map((selector: string) => {
        const trimmed = selector.trim();
        if (trimmed === '*') return scope;
        if ([':before', ':after', '::before', '::after', '::backdrop'].includes(trimmed)) return scope + trimmed;
        if (['html', 'body', ':root', ':host'].includes(trimmed)) return ':where([data-micro-bi-root], [class*="univer-"])';
        return selector;
      });
    },
  }] } },
  build: {
    target: 'es2018',
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
  },
});
