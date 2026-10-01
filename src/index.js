// 垛位推荐算法包统一出口（Node ESM）。
// 浏览器端请勿直接 import 本文件——用 browser.js 的 buildBrowserBundle() 生成
// 经典脚本（IIFE 挂载 window.StackAlloc），由宿主页面内联注入。
export * from './specs.js';
export * from './geometry.js';
export * from './scope.js';
export * from './inbound.js';
export * from './outbound.js';
export * from './restack.js';
