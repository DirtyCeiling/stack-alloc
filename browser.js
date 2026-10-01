// 浏览器经典脚本打包器：把 src/ 各模块拼成一段零依赖 IIFE（挂载 window.StackAlloc），
// 供不能走 ESM 的宿主页面内联注入（Robot_Sim 仿真沙盘 serve.mjs / 无头自测加载器）。
// 约束（src/ 源码必须遵守）：
//   - 只允许 `export function/const/let/class` 与 `import ... from './x.js'` 两种模块语法；
//   - 各文件顶层标识符不得重名（打包时查重，重名直接报错）；
//   - 代码中不得出现 '</script>' / '<!--' 序列（内联进 HTML <script> 的安全边界）。
// CLI：node browser.js --write   落盘 dist/stack-alloc.js（调试用；宿主一般现算现注入）
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, 'src');
const ORDER = ['specs.js', 'geometry.js', 'scope.js', 'inbound.js', 'outbound.js', 'restack.js'];

/** 源文件指纹（宿主 HTTP 缓存失效用）：各源文件 mtime+size 合成 */
export function stackAllocStamp() {
  let stamp = 0;
  for (const f of [...ORDER, 'index.js']) {
    const st = statSync(join(SRC, f));
    stamp += st.mtimeMs + st.size;
  }
  const st = statSync(join(here, 'browser.js'));
  return stamp + st.mtimeMs + st.size;
}

/** 生成经典脚本文本：IIFE 内联全部实现，导出表挂到 window.StackAlloc / globalThis.StackAlloc */
export function buildBrowserBundle() {
  const exported = [];
  const declared = new Set();
  const parts = [];
  for (const f of ORDER) {
    const orig = readFileSync(join(SRC, f), 'utf8');
    for (const m of orig.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
      exported.push(m[1]);
    }
    // 顶层声明查重（拼接后同作用域，重名即 SyntaxError/覆盖，提前拦截）
    for (const m of orig.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (declared.has(m[1])) throw new Error(`[stack-alloc] 顶层标识符重名：${m[1]}（${f}）`);
      declared.add(m[1]);
    }
    const code = orig
      .replace(/^[^\S\n]*import\s+[^\n]*\n/gm, '')                 // 去掉模块内 import
      .replace(/^export\s+(?=async\s+function|function|const|let|class)/gm, '')   // export 前缀降级为普通声明
      .replace(/^export\s*\{[^}]*\};?[^\S\n]*\n/gm, '');           // 去掉导出列表语句（本包不使用，双保险）
    parts.push(`/* ==================== ${f} ==================== */\n` + code.trim());
  }
  const body = parts.join('\n\n');
  if (body.includes('</script>') || body.includes('<!--')) {
    throw new Error('[stack-alloc] 源码含 </script> / <!-- 序列，不能内联进 HTML');
  }
  return `/* StackAlloc 垛位推荐算法包 · 浏览器经典脚本（browser.js 由 src/ 生成，请勿手改） */
(function (g) {
'use strict';
${body}

g.StackAlloc = { ${exported.join(', ')} };
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

// CLI：node browser.js --write 落盘 dist/stack-alloc.js
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes('--write')) {
  const out = join(here, 'dist', 'stack-alloc.js');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildBrowserBundle());
  console.log(`[stack-alloc] 浏览器包已生成：${out}`);
}
