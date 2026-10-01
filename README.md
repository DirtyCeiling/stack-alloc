# StackAlloc — 垛位推荐算法包

钢厂棒材库区的**垛位推荐算法独立实现**：从仿真平台（Robot_Sim）剥离，单一源码、两端共用。

| 环节 | 决策内容 | 入口函数 |
|------|---------|---------|
| 入库（卸货落位） | 一组/一吊某规格钢材落到哪个库位第几垛 | `scoreInCandidates` / `recommendAllocation`（整组贪心）/ `pickInStack`（指定库位选垛） |
| 出库（订单配捆） | 在库捆中选哪捆（被压即倒垛 / 垛顶直取） | `pickOutBundle` / `stackOutBundle` |
| 倒库（倒垛） | 被压目标捆上方整层压货逐吊搬到哪 | `planRestackMoves` / `pickRestackDest` |
| 共享基础 | 垛容几何 / 监测范围 / 压货模型 | `stackCap` `pileDims` `rowsOf` … / `monitoredScopesOf` `regionRestrictedOf` `slotInOpScope` / `bundlePressed` `pressersOf` `freeSeat` |
| 人工在环 | 管理工调整沉淀为权重优化方向 | `learnDeltas` / `scoreAt` / `LEARN_DIMS` |

## 设计原则

- **纯函数、零依赖**：不读数据库、不发请求、不持有配置状态；库房几何参数（`geo`）、
  评分权重（`W`）、捆制规则覆盖（`rules`）、随机源（`rand`）全部由调用方注入。
- **数据视图约定**：调用方把自有库存结构适配为库位/垛视图（见 `src/inbound.js` 头注）；
  垛规格名经 `specNameOf` 访问器取出（沙盘侧 spec 是对象、服务端是字符串，两端同口径）。
- **一个口径**：入库推荐、人工调整校验、实际落位的垛容与评分公式只有这一份实现。

## 接入方式

### Node（服务端）

```js
import { recommendAllocation, stackCap } from '../StackAlloc/src/index.js';
```

Robot_Sim 服务端经 `server/stack-alloc.js` 路径适配器引入（路径变化只改一处）。

### 浏览器（仿真沙盘等不使用 ESM 的页面）

`browser.js` 把 `src/` 拼成经典脚本（IIFE 挂载 `window.StackAlloc`）：

```js
import { buildBrowserBundle, stackAllocStamp } from '../StackAlloc/browser.js';
// serve.mjs：页面 HTML 中的 /*@@stack-alloc@@*/ 占位原位替换为 buildBrowserBundle() 文本
//           （stamp 用于 HTTP 缓存失效）；无头自测经 sandbox-page-loader.mjs 同样注入。
```

调试落盘：`npm run build`（生成 `dist/stack-alloc.js`）。

## 自测

```
npm test     # node self-test.mjs —— 64 项断言：垛容口径/评分分解/贪心分配/选捆策略/倒垛规划/浏览器包
```

## 源码约定（改动 src/ 时必读）

- `browser.js` 的打包是**字符串拼接**：只允许 `export function/const/let/class` 与
  `import ... from './x.js'` 两种模块语法；各文件顶层标识符不得重名（打包时查重）。
- 代码中不得出现 `</script>` / `<!--` 序列（内联 HTML 的安全边界，打包时校验）。
- 评分/垛容公式的任何修改必须同步跑通：`StackAlloc: npm test` +
  `Robot_Sim: npm run db:test` + `node simulation/recommend-probe.mjs`（沙盘口径探针）。
