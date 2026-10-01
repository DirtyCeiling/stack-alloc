// 监测范围（作业范围约束）：调度参数 robot 段配置「监测哪些跨 + 跨内号区范围」。
// 只要监测范围是全库真子集（部分跨关闭，或任一跨限定号区），即视为受限：
//   入库落点只在监测跨内推荐/放行；出库只在监测范围内选捆；范围外不放宽。
// 跨内号区只限定机器狗扫描区，不限制落点（区外转人工核对）。
// 纯函数：robot 参数段由调用方传入（服务端 sim_params / 沙盘 CFG 同构）。

/** 监测范围明细 [{ span, lo, hi }]：跨内号区区间（1~33，起始>截止自动交换） */
export function monitoredScopesOf(params) {
  const r = (params && params.robot) || {};
  const mk = (on, si) => {
    if (!on) return null;
    const f = +r['from' + 'ABC'[si]] || 1, t = +r['to' + 'ABC'[si]] || 33;
    return { span: si, lo: Math.max(1, Math.min(f, t)), hi: Math.min(33, Math.max(f, t)) };
  };
  return [mk(r.spanA, 0), mk(r.spanB, 1), mk(r.spanC, 2)].filter(Boolean);
}

/** 监测范围是否为全库真子集（部分跨关闭，或任一跨限定为跨内号区范围） */
export function regionRestrictedOf(ms) {
  if (ms.length < 3) return ms.length > 0;
  return ms.some(m => m.lo > 1 || m.hi < 33);
}

/** 库位是否在作业范围内（跨级）。
 *  普通库位：所在跨被监测即可（跨内全部号区均可）。
 *  整跨合并位（纵贯 A~C 三跨）：两种口径由 mergedAnySpan 选择——
 *    true（进厂确认页荐垛口径）：任一跨监测即可荐（执行跨由后续调度决定）；
 *    false（沙盘执行口径）：货车按固定跨停靠组车，须该跨被监测（spanOfSlot 给出停靠跨）。 */
export function slotInOpScope(slot, ms, { spanOfSlot, mergedAnySpan = true } = {}) {
  const sp = spanOfSlot ? spanOfSlot(slot) : slot.span;
  if (slot.merged || sp >= 3) return mergedAnySpan ? ms.length > 0 : ms.some(m => m.span === sp);
  return ms.some(m => m.span === sp);
}
