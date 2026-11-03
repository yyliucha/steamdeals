// 后台列表多选（docs/ADMIN-BULK-ACTIONS.md §6.1）。
//
// 设计取舍：
// - 只保留「本页选择」：翻页 / 换筛选时调用 clear()。回收站的「全选当前筛选」是显式例外，
//   由 selectRows(rows) 直接把整批塞进来（≤1000 条，后端也是这个上限）。
// - selectedKeys 按 key 去重：访问明细里同一 IP 会出现多行，后端只认一个键；如果不去重，
//   前端显示「已选 3 条」而后端按 2 条执行，高危确认的条数会对不上。
// - 表格的勾选列状态由 Element Plus 自己维护，clear() 需要同时调 clearSelection()，
//   否则数据清了、勾还留着。
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export function useBulkSelection(keyOf = (row) => row.id, tableRef = null) {
  const selected = ref([]);

  const count = computed(() => selected.value.length);

  const selectedKeys = computed(() => {
    const seen = new Set();
    const keys = [];
    for (const row of selected.value) {
      const key = keyOf(row);
      if (key === null || key === undefined || key === '') continue;
      const sig = String(key);
      if (seen.has(sig)) continue;
      seen.add(sig);
      keys.push(key);
    }
    return keys;
  });

  /** el-table 的 @selection-change 回调。 */
  function onSelectionChange(rows) {
    selected.value = Array.isArray(rows) ? rows : [];
  }

  /** 这一行是否已选（移动端卡片式列表没有勾选列时用）。 */
  function has(row) {
    const sig = String(keyOf(row));
    return selected.value.some((item) => String(keyOf(item)) === sig);
  }

  /** 移动端卡片上的勾选切换。 */
  function toggle(row) {
    const sig = String(keyOf(row));
    const index = selected.value.findIndex((item) => String(keyOf(item)) === sig);
    if (index >= 0) selected.value.splice(index, 1);
    else selected.value.push(row);
  }

  /** 整批选中（回收站「全选当前筛选」）；尽量把当前页的勾也点亮。 */
  function selectRows(rows) {
    selected.value = Array.isArray(rows) ? rows.slice() : [];
    const table = tableRef?.value;
    if (!table?.toggleRowSelection) return;
    for (const row of selected.value) {
      try {
        table.toggleRowSelection(row, true, false);
      } catch {
        /* 行不在当前页时忽略 */
      }
    }
  }

  function clear() {
    selected.value = [];
    try {
      tableRef?.value?.clearSelection?.();
    } catch {
      /* 表格还没挂载 */
    }
  }

  return { selected, count, selectedKeys, onSelectionChange, has, toggle, selectRows, clear };
}

/**
 * 高危动作的二次确认：要求手工输入本次条数（服务端还会再校验一次 confirmCount）。
 * 取消/输入不符返回 null，调用方直接 return。
 */
export async function promptBulkConfirm(count, label = '执行') {
  try {
    const { value } = await ElMessageBox.prompt(
      `即将对 ${count} 条记录执行「${label}」，请再次输入这个数字确认`,
      `确认${label}`,
      {
        inputPattern: /^\d+$/,
        inputErrorMessage: '请输入数字',
        confirmButtonText: '确认执行',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
    if (Number(String(value).trim()) !== Number(count)) {
      ElMessage.warning(`输入的条数与已选（${count}）不一致，已取消`);
      return null;
    }
    return Number(count);
  } catch (err) {
    if (err === 'cancel' || err === 'close') return null;
    throw err;
  }
}
