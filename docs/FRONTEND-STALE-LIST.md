# 愿望单操作后列表不刷新（搜索缓存未失效）（待开发）

> 状态：**根因已确认（2026-11-06），待开发**。
> 关联：[WISHLIST-FIX.md](WISHLIST-FIX.md)（愿望单推送失败，另一条根因）、[WEB.md](WEB.md)、[TODO.md](TODO.md) 的 AF 条目。

## 1. 现象

添加 / 移除愿望单之后，**前端卡片状态仍是操作前的**（例如已加愿望单，卡片还显示"愿望单"未选中；
已移除，卡片仍显示"✓ 愿望单"），必须手动刷新页面才更新。

**只在有搜索词时复现**（例如搜 `company of heroes 3` 后操作）；清空搜索词后操作是正常的。

## 2. 根因

`frontend/src/pages/Home.vue:211` 的 `loadGames()` 带一个 **30 秒搜索结果缓存**：

```js
const cacheKey = params.q
  ? `${params.q}|${params.region}|${params.sort}|…|${params.page}|${params.pageSize}|${user?'u':'g'}|${guestFlagsRev}`
  : '';                                   // ← 只有带搜索词（q）才有 key
const cached = cacheKey && !append ? searchCache.get(cacheKey) : null;
if (cached && Date.now() - cached.at < 30000) {
  applyGames(cached.data, seq, controller);   // ← 直接吃缓存，不发请求
  return;
}
```

三个写操作结束都调用 `await loadGames(page.value)`，但**没有任何一处让缓存失效**：

| 操作 | 位置 | 结果 |
|---|---|---|
| 加入愿望单 | `addWishlist()`（Home.vue:257） | 列表命中 30s 缓存 → 不刷新 |
| 移除愿望单 | `confirmWishlistRemove()`（Home.vue:256） | 同上 |
| 感兴趣 / 不感兴趣 / 已拥有 | `setGameFlag()`（Home.vue:247） | 同样 `loadGames`，同样命中缓存 |

缓存 key 里也没有"数据版本"维度（只有游客标记 `guestFlagsRev`），所以服务端状态变了它也感知不到。

## 3. 方案

**A. 增加失效入口（最小改动）**

在 `Home.vue` 加一个函数，并在每个写操作成功后、`loadGames` 之前调用：

```js
function invalidateSearchCache() { searchCache.clear(); }
```

调用点（全部在 `await loadGames(...)` 之前）：

1. `addWishlist()` 成功分支；
2. `confirmWishlistRemove()` 成功分支；
3. `setGameFlag()`：游客分支（本地标记已变，`guestFlagsRev++` 已能改变 key，但仍建议统一清）与登录分支；
4. `deleteWatch()` 之后（如果当前 tab 会因此变化）。

**B. 或者用版本号（更稳）**

```js
const searchCacheRev = ref(0);          // 写操作后 ++
const cacheKey = params.q ? `…|${searchCacheRev.value}` : '';
```

推荐 **A**：改动小、语义直白（"数据变了，缓存作废"），且不依赖每个写操作都记得加 rev。

**C. 顺手统一行为**

把"写操作 → 失效缓存 → 重新拉列表"收敛成一个 `refreshAfterMutation()`，避免以后新增写操作又忘记。
`WISHLIST-FIX.md` §4 里那 6 项交互改造也走这个入口。

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `frontend/src/pages/Home.vue` | 新增 `invalidateSearchCache()` / `refreshAfterMutation()`；在 `addWishlist`、`confirmWishlistRemove`、`setGameFlag`、`deleteWatch` 的 `loadGames` 前调用 |
| `test/frontend-search-cache.test.js` | **新增**：静态断言——上述函数在 `loadGames` 前调用 `invalidateSearchCache`；`searchCache.clear()` 存在于写操作路径 |

## 5. 验收

1. 搜索 `company of heroes` → 加愿望单 → **卡片立刻显示"✓ 愿望单"**（不用刷新、不用等 30 秒）；
2. 同一搜索下移除 → 卡片立刻恢复；
3. 同一搜索下切换「感兴趣 / 已拥有」→ 立刻生效；
4. 清空搜索词后操作，行为与现在一致（无缓存路径）；
5. **缓存能力仍保留**：不做任何写操作、连续搜索同一关键词两次，第二次仍走缓存（不发请求）；
6. `npm test` 全绿、`npm run frontend:build`。

## 6. 待确认

无。
