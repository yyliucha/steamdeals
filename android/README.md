# SteamDeals 安卓版（TWA）工程

docs/MOBILE-APP-TWA.md §3 生成的 Bubblewrap 工程，随仓库提交（规格决策 7：可复现构建）。

## 关键参数

| 项 | 值 |
|---|---|
| 包名 | `cn.yyliucha.steamdeals`（固定；换签名 = 必须卸载重装） |
| 站点 | `https://sd.yyliucha.cn`，start_url `/` |
| 版本规则 | versionName 跟随 `/api/site` 的 `version`；versionCode = `major*10000 + minor*100 + patch` |
| 签名 | keystore **不入库**（本机 `C:\Users\Administrator\.steamdeals\android.keystore`，密码在同目录 `keystore-pass.txt`，请另备份到私有位置；丢失只能换包名重发） |
| 指纹 | SHA-256 `48:A3:0D:F9:D0:BF:7E:CC:53:EC:E0:AF:2B:69:C4:D4:50:53:04:AD:3B:A5:A2:D3:8F:92:C7:97:D0:F1:7A:05`（已回填 `frontend/public/.well-known/assetlinks.json`） |

## 构建步骤（本机）

```bash
# 环境：JDK 17 + ANDROID_HOME=C:\Android\sdk（platforms;android-36 / build-tools;35.0.0）
cd android
.\gradlew.bat assembleRelease --no-daemon          # 产出 app/build/outputs/apk/release/app-release-unsigned.apk
C:\Android\sdk\build-tools\35.0.0\zipalign.exe -f 4 ..\..\unsigned.apk aligned.apk
C:\Android\sdk\build-tools\35.0.0\apksigner.bat sign --ks <keystore> --ks-key-alias steamdeals --out steamdeals-<ver>.apk aligned.apk
```

产物 → 放 `frontend/public/app/steamdeals-<version>.apk` 并更新同目录 `latest.json`（版本/SHA-256/大小/日期），
再走站点发版（**APK 必须先入库、后下令构建**，规格 §5.3）。

## 备注

- 依赖 androidx 要求 compileSdk ≥36、minSdk ≥24（bubblewrap 模板默认已被本项目改成 36/24）；
- `enableNotifications=false`（本批不做推送/角标）；
- 外链（Steam 等）由 Custom Tabs 打开（`fallbackType: customtabs`）。
