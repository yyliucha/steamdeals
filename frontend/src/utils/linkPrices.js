// BD 批（docs/ADMIN-LINKS-DRAWER.md §12）：链接抽屉「最低价」判定。
// 约束（与产品口径一致）：
//   1. 币种不折算——只在**同一币种**内比大小；以排序后第一项（国区优先）的币种为基准，
//      没有同币种的可比较项就不标「最低价」（跨币种比较会算错）；
//   2. 缺货不参与（缺货价格不可购买，标「最低价」会误导）；
//   3. 至少 2 条可比且存在唯一最低才返回该条；只有 1 条或全部同价 → null（没有比较意义）。
export function pickLowestLink(links) {
  const list = Array.isArray(links) ? links.filter((l) => l && typeof l === 'object') : [];
  if (!list.length) return null;
  const cur = (l) => String(l?.currency || 'CNY').toUpperCase();
  const anchor = cur(list[0]);
  const comparable = list.filter((l) => l.in_stock && cur(l) === anchor && Number(l.price_cents) > 0);
  if (comparable.length < 2) return null;
  let low = comparable[0];
  for (const l of comparable) if (Number(l.price_cents) < Number(low.price_cents)) low = l;
  const min = Number(low.price_cents);
  if (comparable.every((l) => Number(l.price_cents) === min)) return null; // 全部同价
  return low;
}
