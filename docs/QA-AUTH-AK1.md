# QA：密码策略 + 哈希升级（AK-1 批，第 1 轮）

> 基线 ac41581 → HEAD bb3b58b；判据 [docs/AUTH-REDESIGN.md](AUTH-REDESIGN.md) §4.1/§4.2/§6.4/§7 验收 1、2、12（AK-1 范围）；
> 开发描述来源：开发会话汇报（5a86013 代码 + bb3b58b 文档）。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AK-1 | 新密码最低 12 位（最长 200），11 位及以下一律拒绝 | 所有设置密码入口 | ✅ | password-policy.js:MIN_LENGTH；test/password-policy.test.js:19-25 |
| 2 | AK-1 | 弱口令黑名单：常见密码与「词根+数字尾巴」变体（password1234 等）拒绝 | 同上 | ✅ | password-policy.js（COMMON_BASE_RE）；test:27-32 |
| 3 | AK-1 | 含用户名 / 邮箱 @ 前部分（≥4 位、忽略大小写）拒绝 | 同上 | ✅ | password-policy.js；test:35-41 |
| 4 | AK-1 | 全同字符 / 连续序列（≥6）拒绝（aaaaaaaaaaaa、123456789012、abcdefghijkl） | 同上 | ✅ | password-policy.js（isSequential）；test:44-51 |
| 5 | AK-1 | 密码强度评分 0–4（长度档位 + common/身份压制） | POST /api/password/check（前端强度条用） | ✅ | password-policy.js；test:44-51 |
| 6 | AK-1 | 六个设置密码入口统一策略（初始化/后台建号/后台重置/自助重置/CLI；注册与改密后续接入同一函数） | 各入口 | ✅ | setup-routes.js/server.js/auth-routes.js/cli.js；test:136-178、179-198 |
| 7 | AK-1 | scrypt 版本化哈希 `$scrypt$32768$8$1$…`（新账号即新格式） | 密码落库 | ✅ | pg.js（hashPassword）；test:54-66 |
| 8 | AK-1 | 旧 `salt:hash` 账号仍能登录，登录成功后静默升级为新格式并更新 password_updated_at | 登录 | ✅ | pg.js（verifyPassword 兼容）；server.js（rehash）；test:69-96 |
| 9 | AK-1 | 登录时评估弱密码并落库（weak_password 三态，供 AK-2 后台标红） | 登录 | ✅ | server.js；test:69-96 |
| 10 | AK-1 | `POST /api/password/check`：匿名可用、每 IP 每分钟 30 次限流、只评估不回显用户信息 | 公开接口 | ✅ | server.js；test:98-122 |
| 11 | AK-1 | users 表补 5 列（must_change_password/failed_login_count/locked_until/weak_password/password_updated_at）幂等迁移 | 数据库迁移 | ✅ | pg.js ALTERS |
| 12 | AK-1 | 主链全绿（新增 test/password-policy.test.js 入主链）+ api/email-auth 链外 + build + scan | CI 验证 | ✅ | 亲自重跑（见下） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §7.1 策略各判定与通过例 | 单测逐例 | test/password-policy.test.js:19-51 | ✅ |
| 2 | §7.1 六入口规则一致（AK-1 范围：现有五入口 + 同一函数供注册/改密） | HTTP 测试（建号/重置/自助重置/初始化）+ 静态断言（CLI） | test:136-178、179-198、200-207 | ✅ |
| 3 | §7.2 新账号新格式 | hashPassword 输出断言 | test:54-66 | ✅ |
| 4 | §7.2 老格式兼容 + 登录静默升级 | HTTP：旧哈希账号登录 → 库里变新格式 | test:69-96 | ✅ |
| 5 | §4.1 黑名单 Top 1 万不引依赖 | src/data/common-passwords.js（SecLists 10k 快照，Set 加载） | common-passwords.js | ✅ |
| 6 | §4.1 不 trim / 不做 Unicode 归一化 | 代码无 trim/NFKC | password-policy.js（String(password) 原样） | ✅ |
| 7 | §4.1 check 接口匿名 + 限流 + 返回字段 | HTTP 测试（200/429/字段） | test:98-122 | ✅ |
| 8 | §4.2 版本化格式与 maxmem | `$scrypt$32768$8$1$` + 64MB maxmem | pg.js | ✅ |
| 9 | §4.2 needsRehash + 登录升级日志 auth.password_rehashed | 代码 + 单测 | pg.js；server.js；test:54-66 | ✅ |
| 10 | §3 五列补列幂等 | ALTERS if not exists | pg.js:352-361 | ✅ |
| 11 | §6.4 密码不进日志 | 登录/策略日志无密码字段 | server.js（api.login 日志） | ✅ |
| 12 | §7.12 npm test 全绿 + 新测试入主链 + build + scan | 亲自重跑 | npm test 62 文件/515 项 fail 0；api.test 22 项；email-auth 9 项；frontend:build ✓；scan 干净 | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test               → 62 个文件 / pass 515 / fail 0
node test/api.test.js  → pass 22 / fail 0
node test/email-auth.test.js → pass 9 / fail 0（顺带修复 AI 批遗留的过期断言：模板主题与 multipart 提取）
npm run frontend:build → ✓
npm run scan           → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

- 老部署升级后，管理员用旧 8 位密码**仍能登录**（静默升级哈希 + 弱密码标红由 AK-2 呈现），
  但**新建/重置**将要求 ≥12 位——上线后请确认运维习惯（AK-3 会给管理员临时密码方案）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即通过，无打回项。
