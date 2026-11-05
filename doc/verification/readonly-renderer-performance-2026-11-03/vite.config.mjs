import {defineConfig,normalizePath} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const projectRoot=fileURLToPath(new URL('../../../',import.meta.url));
const here=fileURLToPath(new URL('./',import.meta.url));
const output=process.env.PERF_DIR || path.join(os.tmpdir(),'micro-bi-renderer-perf');
const alias=[['@visactor/vtable','@visactor/vtable/es/index.js'],['@univerjs/core','@univerjs/core/lib/es/index.js'],['@univerjs/presets','@univerjs/presets/lib/es/index.js'],['@univerjs/preset-sheets-core','@univerjs/preset-sheets-core/lib/es/index.js']].map(([name,entry])=>({find:new RegExp('^'+name+'$'),replacement:normalizePath(path.join(projectRoot,'node_modules',entry))}));
export default defineConfig({root:projectRoot,define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias},build:{target:'es2020',outDir:path.join(output,'dist'),minify:false,lib:{entry:path.join(here,'index.ts'),formats:['es'],fileName:()=> 'index.js'},rollupOptions:{output:{chunkFileNames:'chunks/[name]-[hash].js'}}}});
