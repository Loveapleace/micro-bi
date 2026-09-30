import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const esmDir = fileURLToPath(new URL('../dist/esm/', import.meta.url));
const cjsDir = fileURLToPath(new URL('../dist/cjs/', import.meta.url));

// 根 package.json 声明了 "type": "module"，
// 因此必须在 CJS 产物目录内放置标记文件，Node 才会把 .js 当作 CommonJS 解析。
if (!existsSync(esmDir) || !existsSync(cjsDir)) {
  throw new Error('[postbuild] 构建产物缺失，请确认 build:esm / build:cjs 均已执行');
}

await mkdir(cjsDir, { recursive: true });
await writeFile(
  new URL('../dist/cjs/package.json', import.meta.url),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
  'utf8',
);

console.log('[postbuild] dist/cjs/package.json -> { "type": "commonjs" }');
console.log('[postbuild] 构建完成');
