# QA：建号与邮箱绑定原子化（第 1 轮）

> 基线 `6e863a8` → 交付 `f5e9d72`；判据：所有者 2026-11-06 反馈的 bug（邮箱已被占用时提示创建失败，刷新列表却出现已建用户）。
> 结论：**✅ 放行 —— 通过 11 / 缺失 0 / 偏差 0 / 需人工确认 1**

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 建号接口接受可选 email，同一次 INSERT 落库 | grep `createUser` | pg.js `insert into users (username, password_hash, role, email)…` | ✅ |
| 2 | 邮箱冲突 → 409「这个邮箱已被其他账号绑定」，不产生残号 | grep `23505` | server.js：`23505` 按约束名分「邮箱/用户名」两条 409 | ✅ |
| 3 | 用户名冲突 → 409「用户名已存在」（原为 500） | 同上 | server.js 同分支 | ✅ |
| 4 | 邮箱格式非法 → 400，不建号 | grep `邮箱格式不正确` | server.js：`normalizeEmail` 为空即 400，先于插入 | ✅ |
| 5 | 老库缺列兜底（42703 补列重试） | grep `42703` | server.js 建号路由同绑邮箱路由同款兜底 | ✅ |
| 6 | 前端一次请求带 email，不再二次调用绑邮箱接口 | grep AdminExtras `createUser` | 无 `/email` 二次调用；`email:u.email.trim()\|\|undefined` | ✅ |
| 7 | 测试真锁住行为：邮箱占用 → 409 且用户数不变 | 单跑 + 主链 | `test/admin-users.test.js` 6 项，含原子性断言（用户数不变、无 carol 残号） | ✅ |
| 8 | 新测试已进主链 | grep package.json | `node test/admin-users.test.js` 已插入 test 脚本 | ✅ |
| 9 | 文档同步 | grep PROJECT-OVERVIEW | 「Web/API、安装和账户」行补原子化说明 | ✅ |
| 10 | 纪律：无 tag、未碰部署/服务器配置、无构建产物、已推 main | git 取证 | diff 仅 6 个源码/文档文件；tag 无新增；f5e9d72 在 main | ✅ |
| 11 | 验证重跑 | 命令输出 | `node test/admin-users.test.js` 6/6；`npm test` EXIT=0（51 文件）；`frontend:build` EXIT=0（1.68s）；`scan` EXIT=0 | ✅ |

## 需人工确认

1. 生产站实际表现（部署后）：后台建号填已占用邮箱 → 应弹「这个邮箱已被其他账号绑定」且刷新列表无新增用户。代码与测试已锁死行为，生产复验需等下次构建部署。

## 备注（不阻塞）

- 42703 兜底分支（老库缺 email 列）在本地无法覆盖（生产已有列），属防御代码，已在测试环境外目检。
- 空邮箱时前端传 `undefined`（JSON 序列化丢弃），后端按无邮箱处理，向后兼容。

## 复检记录

第 1 轮（2026-11-06）：无打回项，✅ 放行。
