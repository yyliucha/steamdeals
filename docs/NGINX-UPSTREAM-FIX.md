# 部署稳定性：nginx upstream 跟随容器 IP（FD，待开发，2026-11-23）

> 现象（2026-11-23）：每次发版后 https://sd.yyliucha.cn 返回 502——nginx（docker 容器）upstream
> 写的是容器名 `steamdeals:8080`，nginx 启动时解析为 IP 并缓存；app 容器重建后 IP 变化 → 连接旧 IP 被拒。
> 所有者确认采用「方案 A」根治。

## 1. 现状

- nginx 容器（`nginx:latest`，宿主机 80/443）反代 `upstream steamdeals { server steamdeals:8080; keepalive 256; }`；
- app 容器（compose）端口映射 `127.0.0.1:8520:8080`（**只绑 loopback**——宿主机端口方案不可用）；
- app 重建后容器 IP 变化，nginx 缓存旧 IP → 502（`connect() failed ... upstream "http://172.18.0.x:8080"`）；
- 临时缓解：`docker restart nginx`。

## 2. 方案 A（根治：nginx 跟随容器 DNS）

1. **nginx 加入 app 所在网络** `webnet`（external）：`docker network connect webnet nginx`（持久化）；
2. **nginx 配置改用 resolver 变量**，按 TTL 重新解析（不缓存启动时 IP）：
   ```nginx
   resolver 127.0.0.11 valid=10s ipv6=off;   # docker 内置 DNS
   set $steamdeals_upstream steamdeals:8080;
   proxy_pass http://$steamdeals_upstream$request_uri;
   ```
   （`keepalive` 与变量 proxy_pass 不兼容时按需调整；或保留 upstream 块 + `resolver` 仅对 DSN 名称——按 nginx 版本验证）
3. 验收：app 容器重建（`docker compose up -d --force-recreate app`）后，**无需重启 nginx**，
   10 秒内域名恢复 200。

## 3. 备选（若方案 A 受 nginx 版本限制）

- 部署步骤固定加 `docker restart nginx`（写入 DELIVERY 部署清单）；或
- app 端口映射改 `172.17.0.1:8520:8080` + nginx upstream 改 `172.17.0.1:8520`（不依赖容器 IP，但端口暴露面变化需评估）。

## 4. 验收

1. 发版（重建 app）后域名自动恢复（无需人工 restart nginx）或按部署清单执行后恢复；
2. `docker exec nginx getent hosts steamdeals` 解析正确；
3. 502 不再复现；DELIVERY 部署步骤更新。

## 5. 边界

- 不改 nginx 的 TLS/证书/其他 server 块；不改 app 内部端口（8080）；
- 属于服务器侧运维配置（不随镜像发版），落地时由部署人员执行并记录到 DELIVERY。
