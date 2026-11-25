// FQ 批（docs/UI-BUTTON-FEEDBACK.md §3）：按钮点击反馈 composable。
//
// 统一「点击即反馈」规范：
//   · 点击瞬间 loading/禁用（loading 期间再次点击直接忽略，防连点）；
//   · loading 至少持续 minMs（默认 200ms），避免一闪而过；
//   · 成功 → ElMessage.success（success 可为文案或 (result)=>文案）；
//   · 失败 → ElMessage.error（error 可为文案或 (e)=>文案，缺省取 e.message）。
//
// 消息函数可注入（测试传假实现，避免在 Node 里触发真实 DOM 消息），默认 ElMessage。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

export function useAction({ successMsg = (m) => ElMessage.success(m), errorMsg = (m) => ElMessage.error(m) } = {}) {
  const loading = ref(false);

  async function run(fn, { success = null, error = null, refresh = null, minMs = 200 } = {}) {
    if (loading.value) return null; // 防连点：loading 期间不发起第二次请求
    loading.value = true;
    const startedAt = Date.now();
    try {
      const result = await fn();
      await holdMin(startedAt, minMs);
      if (success) successMsg(typeof success === 'function' ? success(result) : success);
      if (refresh) await refresh(result);
      return result;
    } catch (e) {
      await holdMin(startedAt, minMs);
      const message =
        typeof error === 'function' ? error(e) : error ?? e?.message ?? String(e ?? '操作失败');
      // error 回调返回 null/undefined 表示已自行处理提示（如 409 用 warning），不再重复弹错误
      if (message) errorMsg(message);
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { loading, run };
}

/** 保证 loading 至少可见 minMs（不足则补足剩余时长）；纯函数，供测试锁定。 */
export function holdMin(startedAt, minMs) {
  const left = minMs - (Date.now() - startedAt);
  return left > 0 ? new Promise((resolve) => setTimeout(resolve, left)) : Promise.resolve();
}
