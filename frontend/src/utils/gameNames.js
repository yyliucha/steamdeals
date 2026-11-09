// 游戏名复制（AO 批 docs/ADMIN-LINKS-DRAWER.md §5）：一次复制中英文两行。
export function nameCopyText(game) {
  const zh = String(game?.name ?? '').trim();
  const en = String(game?.name_en ?? '').trim();
  if (!en || en === zh) return zh || en;
  if (!zh) return en;
  return `${zh}\n${en}`;
}
