# 部署侧配置优化：nginx gzip / HTTP2 / 反向代理调优（2026-11-09）

> 状态：**已落地（2026-11-10，sd.yyliucha.cn）**——gzip / HTTP2 / 上游长连接 / HSTS 单头全部生效，见 §0。
> 本文件给配置与验证方法，服务器操作由部署人员按 [DEPLOY.md](DEPLOY.md) 执行。
> 背景：2026-11-09 实测首页 `index-*.js` **279,480 B**、`index-*.css` **134,752 B** 均**未压缩**
> （响应无 `content-encoding`、无 `vary`），nginx 未开 gzip。开 gzip 后预计降到 ~90KB / ~20KB（省约 70%）。
> 关联：[READ-MODEL.md](READ-MODEL.md)（AV 批：应用侧列表查询，2.8s→目标 <150ms，与本文件互补）
## 0. 落地记录（2026-11-10）

实际生效的四项（sd.yyliucha.cn）：

| 项 | 配置位置 | 结果 |
|---|---|---|
| gzip | 新增 `/home/ubuntu/nginx/conf.d/00-gzip.conf`（http 级） | `index-*.js` 279,480 → **91,880 B**；`index-*.css` 134,752 → **22,078 B**；`vary: Accept-Encoding` 出现 |
| HTTP/2 | `steamdeals.conf` server 块 `http2 on;`（nginx ≥1.25.1） | `HTTP/2 200` |
| 上游长连接 | `upstream steamdeals { keepalive 256; }` + 每个 location 的 `proxy_http_version 1.1;`、`proxy_set_header Connection "";` | 配置生效（`nginx -T` 各 2 处） |
| HSTS 单头 | 每个 location 加 `proxy_hide_header Strict-Transport-Security;` | `grep -ci strict-transport-security` = **1**（原 2） |

**两个踩坑（都是"配置写了但没生效"）**

1. `keepalive 256` 单独写没用：`common/proxy.conf` 只有 Host / X-Real-IP / XFF / XFP，缺
   `proxy_http_version 1.1` 与 `proxy_set_header Connection ""`，nginx 默认 HTTP/1.0 打上游 → 长连接不建立。
2. HSTS 双发：nginx `add_header` 一份 + 应用 `applySecurityHeaders` 一份；用 `proxy_hide_header` 隐藏上游那份，
   保留 nginx 的（nginx 生成的 502/504 也带 HSTS）。

**运维提醒**：`upstream` 里写的是容器名 `steamdeals:8080`，**启动时解析一次**；重建 app 容器后要
`docker exec nginx nginx -s reload`，否则 nginx 还连旧 IP 会 502。


## 1. 先摸清现状（只读）

```bash
# 站点是 nginx 容器前置：nginx(80/443) → 127.0.0.1:8520 → app 容器 8080
docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Image}}'

# 配置挂载在哪（宿主机改，容器内只读）
docker inspect nginx --format '{{json .Mounts}}' | tr ',' '\n' | grep -i -E 'Source|Destination'

# 生效的完整配置（含 include 的 conf.d / sites）
docker exec nginx nginx -T 2>/dev/null | grep -n -E 'server_name|gzip|http2|proxy_pass|add_header' | head -60

# 版本与编译模块（确认有没有 brotli / http2）
docker exec nginx nginx -V 2>&1 | tr ' ' '\n' | grep -E '^--with-http_v2|brotli|^nginx version'
```

`docker exec nginx nginx -T` 输出的就是"实际生效配置"，改之前先备份：

```bash
# 宿主机上（路径以第 2 步查到为准，示例）
sudo cp /opt/nginx/conf.d/steamdeals.conf /opt/nginx/conf.d/steamdeals.conf.bak-$(date +%F)
```

## 2. 改动一：开启 gzip（http 块，收益最大）

在 `http { ... }` 里加（若已有 `gzip` 行就改成下面这组，**不要重复写**）：

```nginx
gzip on;
gzip_vary on;                 # 必须：让 CDN/代理按 Accept-Encoding 缓存，避免串包
gzip_comp_level 6;            # 5~6 是性价比拐点；9 太耗 CPU，收益 <2%
gzip_min_length 1024;         # 小于 1KB 不压（如 /api/announcements 的 33B）
gzip_proxied any;             # 反向代理场景照压
gzip_types
    text/plain
    text/css
    text/javascript
    application/javascript
    application/json
    application/xml
    image/svg+xml
    application/manifest+json;
# 不要加：image/jpeg image/png image/webp image/avif font/woff2（本身已压缩，压了更大）
# text/html 默认就会压，不必列
```

> 如果 `nginx -V` 里带 `brotli` 模块，可再加（可选，比 gzip 再省 15–20%）：
> ```nginx
> brotli on;
> brotli_comp_level 5;
> brotli_types text/css application/javascript application/json image/svg+xml;
> ```
> 没有该模块就不要写，`nginx -t` 会直接报错。

## 3. 改动二：HTTP/2 + 反向代理长连接（第二个便宜收益）

```nginx
# server 块（443）
listen 443 ssl;
http2 on;                     # nginx ≥1.25.1 的写法；旧版用 listen 443 ssl http2;
server_tokens off;

# upstream：与 8520 保持长连接，省掉每个请求的 TCP 握手
upstream steamdeals {
    server 127.0.0.1:8520;
    keepalive 32;
}

location / {
    proxy_pass http://steamdeals;
    proxy_http_version 1.1;
    proxy_set_header Connection "";          # 配合 keepalive
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

注意：
- 现有配置若是 `proxy_pass http://steamdeals$request_uri;`（把原 URI 原样带上），改成 upstream 名后要确认路径不被重复拼接——`proxy_pass http://steamdeals;`（不带 URI）会保留原始 `$request_uri`，通常等价。
- `proxy_set_header Connection ""` 必须配 `proxy_http_version 1.1;`，否则长连接无效。
- 应用已对 `/assets/*` 发 `cache-control: public, max-age=31536000, immutable`，nginx 原样透传即可，**不要**再加 `expires` 覆盖成更短的值。

## 4. 可选：静态资源在 nginx 层做微缓存（应用重启/慢查询时更稳）

只缓存 `/assets/`（带内容哈希，不会脏）：

```nginx
# http 块
proxy_cache_path /var/cache/nginx/static levels=1:2 keys_zone=staticcache:16m inactive=7d max_size=1g;

# server 块
location /assets/ {
    proxy_pass http://steamdeals;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_cache staticcache;
    proxy_cache_valid 200 7d;
    proxy_cache_use_stale error timeout updating;
    add_header X-Cache-Status $upstream_cache_status always;
}
```

> 不要缓存 `/api/*`（含登录态、用户标记、后台数据）。`/img/*` 是应用自己的 LRU + 磁盘缓存，nginx 层不必再套。

## 5. 校验与回归（顺序固定）

```bash
# 1) 语法检查
docker exec nginx nginx -t

# 2) 灰度重载（不中断连接）
docker exec nginx nginx -s reload

# 3) 压缩是否生效（注意用 GET，别用 -I）
ASSET=$(curl -s https://sd.yyliucha.cn/ | grep -o '/assets/index-[^"]*\.js' | head -1)
echo "$ASSET"
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "https://sd.yyliucha.cn$ASSET" \
  | grep -iE 'content-encoding|vary|content-length'
curl -s -o /dev/null -w 'gzip 下载字节: %{size_download}\n' -H 'Accept-Encoding: gzip' "https://sd.yyliucha.cn$ASSET"
curl -s -o /dev/null -w '不压缩字节: %{size_download}\n' "https://sd.yyliucha.cn$ASSET"
```

**预期结果**

| 请求 | 改前 | 改后（参考） |
|---|---|---|
| `/assets/index-*.js` | 279,480 B | ~85–95 KB（`content-encoding: gzip` + `vary: Accept-Encoding`） |
| `/assets/index-*.css` | 134,752 B | ~18–22 KB |
| HTML `/` | 2.8 KB | 不压（2.8KB < min_length 也不必压），仍 `no-cache` |
| `POST /api/games/search` | 10.8 KB | ~2–3 KB（JSON 会压） |

**回归检查**
- 首页、详情弹窗、后台 `/console` 都能正常加载（gzip 配错最典型的现象是白屏/JS 解析错误）；
- `curl -sI` 看 `vary: Accept-Encoding` 在，避免中间缓存串包；
- 重复头清理：应用已发 `strict-transport-security`，nginx 又发一次 `Strict-Transport-Security`（大小写不同、重复），
  建议**只留一处**（保留 nginx 的，删应用的，或在 nginx 用 `proxy_hide_header` 去掉一个）。

## 6. 配置项层面的其它优化（按性价比）

| # | 项 | 现状/建议 | 影响 |
|---|---|---|---|
| 1 | `gzip` | 未开 → 开（§2） | **最大**：首包 414KB → ~110KB |
| 2 | HTTP/2 | 未确认 → 开（§3） | 大：多路复用，首屏并发请求不再排队 |
| 3 | upstream `keepalive` | 未确认 → 开（§3） | 中：省 TCP 握手，TTFB 稳定 |
| 4 | 静态微缓存 | 未开 → 可选（§4） | 中：应用重启/慢查询时静态资源不受影响 |
| 5 | 重复 HSTS 头 | 两处都发 → 留一处 | 小：响应更干净，避免策略互相覆盖 |
| 6 | `access_log` | 两个 server 块 `off` → 至少 4xx/5xx 打开 | 小：排障需要（历史踩过"零日志"） |
| 7 | PG 参数 | `shared_buffers` / `work_mem` / `random_page_cost` 未调 | 中：列表查询优化后，PG 侧仍有收益 |
| 8 | 应用连接池 | `max: 4`（`src/store/index.js`） | 中：并发高时排队；属代码改动，另开条目 |

> 第 7/8 项不要和 gzip 同一次改：先上 gzip + HTTP/2（纯部署、可回滚），观测 1–2 天再动数据库与应用参数。

## 7. 回滚

```bash
sudo cp /opt/nginx/conf.d/steamdeals.conf.bak-YYYY-MM-DD /opt/nginx/conf.d/steamdeals.conf
docker exec nginx nginx -t && docker exec nginx nginx -s reload
```

改配置前先备份、`nginx -t` 通过再 reload；reload 不中断在途请求。容器以只读方式挂载配置时，改宿主机文件即可。
