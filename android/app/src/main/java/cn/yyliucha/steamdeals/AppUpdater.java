package cn.yyliucha.steamdeals;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.List;

// BY 批（docs/MOBILE-APP-UPDATE.md §4）：安卓 App 内置更新——
// 检查（启动 + 回前台 24h 节流 + 手动 scheme）→ 原生对话框（可选/强制）→
// 下载（站点优先、GitHub 兜底、默认仅 Wi-Fi、SHA-256 校验）→ 用户确认安装（覆盖升级，签名不变）。
public class AppUpdater {
    private static final String BASE_URL = "https://sd.yyliucha.cn";
    private static final String CHECK_URL = BASE_URL + "/api/app/latest";
    private static final String GITHUB_RELEASE = "https://github.com/yyliucha/steamdeals/releases/download/";
    private static final String PREFS = "sd_update";
    private static final String KEY_IGNORED_VERSION = "ignoredVersionCode";
    private static final String KEY_LAST_CHECK_AT = "lastCheckAt";
    private static final String KEY_ALLOW_MOBILE = "allowMobileDownload";
    private static final long CHECK_THROTTLE_MS = 24L * 60 * 60 * 1000; // 24 小时

    private static long lastDownloadId = -1;
    private static String lastExpectedSha = null;
    private static long lastApkSize = -1;
    private static String lastVersion = "";
    private static String lastApkPath = "";

    private AppUpdater() {}

    /** 只允许 https + 白名单主机（站点 / GitHub 及其资源域），其它地址拒绝。 */
    public static boolean isAllowedUrl(String url) {
        try {
            URI u = new URI(url);
            if (!"https".equalsIgnoreCase(u.getScheme())) return false;
            String host = u.getHost();
            if (host == null) return false;
            if ("sd.yyliucha.cn".equals(host)) return true;
            if ("github.com".equals(host) || host.endsWith(".github.com")) return true;
            return "objects.githubusercontent.com".equals(host);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 检查更新。manual=true 时不写「已检查时间」（不影响 24h 节流）。
     * 全程静默：网络失败不打扰（下次再试）；只有发现可更新版本才弹对话框。
     */
    public static void checkForUpdate(final Activity activity, final boolean throttled, final boolean manual) {
        final long now = System.currentTimeMillis();
        final SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        // 回前台检查按 24h 节流；启动与手动入口不受节流；手动检查不写「已检查时间」（§4.5）
        if (!manual && throttled && now - prefs.getLong(KEY_LAST_CHECK_AT, 0) < CHECK_THROTTLE_MS) return;
        if (!manual) prefs.edit().putLong(KEY_LAST_CHECK_AT, now).apply();

        new Thread(new Runnable() {
            @Override public void run() {
                JSONObject latest = fetchJson(CHECK_URL);
                if (latest == null) {
                    // 站点不可达：直接试 GitHub 兜底会没有版本信息，本批检查阶段静默（§4.6）
                    return;
                }
                final int versionCode = latest.optInt("versionCode", -1);
                final int minVersionCode = latest.optInt("minVersionCode", -1);
                final String version = latest.optString("version", "");
                final long size = latest.optLong("size", -1);
                final String apkPath = latest.optString("apkPath", "");
                final String sha256 = latest.optString("sha256", "");
                final List<String> notes = new ArrayList<>();
                JSONArray notesArr = latest.optJSONArray("notes");
                if (notesArr != null) {
                    for (int i = 0; i < notesArr.length(); i++) notes.add(notesArr.optString(i));
                } else {
                    String note = latest.optString("notes", "");
                    if (note.length() > 0) notes.add(note);
                }
                final int currentCode = BuildConfig.VERSION_CODE;
                if (versionCode <= 0 || versionCode <= currentCode) return; // 无更新
                final boolean forced = minVersionCode > currentCode;
                final int ignored = prefs.getInt(KEY_IGNORED_VERSION, -1);
                if (ignored == versionCode && !forced) return; // 忽略此版本（强制时忽略不生效）

                activity.runOnUiThread(new Runnable() {
                    @Override public void run() {
                        showUpdateDialog(activity, version, versionCode, size, notes, apkPath, sha256, forced);
                    }
                });
            }
        }).start();
    }

    private static JSONObject fetchJson(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestMethod("GET");
            conn.setUseCaches(false);
            conn.setRequestProperty("Cache-Control", "no-cache");
            int code = conn.getResponseCode();
            if (code != 200) return null;
            InputStream in = new BufferedInputStream(conn.getInputStream());
            StringBuilder sb = new StringBuilder();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, "UTF-8"));
            in.close();
            return new JSONObject(sb.toString());
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String apkUrl(String apkPath) {
        String p = apkPath == null ? "" : apkPath.trim();
        if (p.startsWith("http://") || p.startsWith("https://")) return p;
        return BASE_URL + (p.startsWith("/") ? p : "/" + p);
    }

    private static String githubFallbackUrl(String version, String apkPath) {
        String base = "steamdeals-" + version + ".apk";
        if (apkPath != null && apkPath.contains("/")) {
            String name = apkPath.substring(apkPath.lastIndexOf('/') + 1);
            if (name.length() > 0) base = name;
        }
        return GITHUB_RELEASE + "app-v" + version + "/" + base;
    }

    private static void showUpdateDialog(final Activity activity, final String version, final int versionCode,
                                         final long size, final List<String> notes, final String apkPath,
                                         final String sha256, final boolean forced) {
        String title = "发现新版本 v" + version;
        StringBuilder body = new StringBuilder();
        if (size > 0) body.append("安装包大小：").append(formatSize(size)).append("\n");
        if (!notes.isEmpty()) {
            body.append("更新说明：\n").append(TextUtils.join("\n", notes));
        }
        AlertDialog.Builder b = new AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage(body.toString().trim())
                .setCancelable(!forced);
        if (forced) {
            b.setNegativeButton("立即更新", (d, w) -> startDownload(activity, apkUrl(apkPath), sha256, size, version, apkPath));
        } else {
            b.setPositiveButton("立即更新", (d, w) -> startDownload(activity, apkUrl(apkPath), sha256, size, version, apkPath));
            b.setNeutralButton("稍后", null);
            b.setNegativeButton("忽略此版本", (d, w) -> {
                activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit().putInt(KEY_IGNORED_VERSION, versionCode).apply();
                Toast.makeText(activity, "已忽略 v" + version + "，出现更高版本会再提示", Toast.LENGTH_SHORT).show();
            });
        }
        AlertDialog dialog = b.create();
        if (forced) dialog.setCanceledOnTouchOutside(false);
        dialog.show();
    }

    private static String formatSize(long bytes) {
        return new DecimalFormat("0.0").format(bytes / 1024.0 / 1024.0) + " MB";
    }

    private static boolean isWifi(Context ctx) {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
            return ni != null && ni.getType() == ConnectivityManager.TYPE_WIFI;
        } catch (Exception e) {
            return true; // 取不到网络状态时不拦（保守放行）
        }
    }

    private static void startDownload(final Activity activity, final String url, final String sha, final long size,
                                      final String version, final String apkPath) {
        if (!isAllowedUrl(url)) {
            Toast.makeText(activity, "下载地址不合法，已拒绝", Toast.LENGTH_SHORT).show();
            return;
        }
        final SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!isWifi(activity) && !prefs.getBoolean(KEY_ALLOW_MOBILE, false)) {
            new AlertDialog.Builder(activity)
                    .setTitle("当前是移动网络")
                    .setMessage("默认仅 Wi-Fi 下载。是否使用流量下载更新包（约 " + formatSize(size > 0 ? size : 0) + "）？")
                    .setPositiveButton("使用流量下载", (d, w) -> {
                        prefs.edit().putBoolean(KEY_ALLOW_MOBILE, true).apply();
                        doDownload(activity, url, sha, size, version, apkPath);
                    })
                    .setNegativeButton("仅 Wi-Fi 下载", (d, w) -> openFallbackPage(activity))
                    .setCancelable(false)
                    .show();
            return;
        }
        doDownload(activity, url, sha, size, version, apkPath);
    }

    private static boolean fallbackTried = false;

    private static void doDownload(final Activity activity, final String url, final String sha, final long size,
                                   final String version, final String apkPath) {
        fallbackTried = false;
        enqueueDownload(activity, url, sha, size, version, apkPath);
    }

    private static void enqueueDownload(final Activity activity, final String url, final String sha, final long size,
                                        final String version, final String apkPath) {
        try {
            DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("SteamDeals v" + version);
            req.setDescription("下载完成后请在系统弹窗中确认安装");
            req.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, "steamdeals-" + version + ".apk");
            req.setAllowedOverMetered(false);
            req.setAllowedOverRoaming(false);
            long id = dm.enqueue(req);

            lastDownloadId = id;
            lastExpectedSha = sha;
            lastApkSize = size;
            lastVersion = version;
            lastApkPath = apkPath;

            // 完成广播：校验 → 安装；失败（含 SHA 不匹配）时给重试/打开发布页
            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    long doneId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (doneId != lastDownloadId) return;
                    try {
                        context.unregisterReceiver(this);
                    } catch (Exception ignored) {}
                    onDownloadFinished(activity, doneId, sha, version, apkPath, size);
                }
            };
            activity.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

            showDownloadProgress(activity, id, receiver, version, apkPath, sha, size);
        } catch (Exception e) {
            onDownloadFailed(activity, version, apkPath, sha, size);
        }
    }

    /** 站点失败自动回落 GitHub Release 同版本 APK（一次）；再失败才弹重试/发布页。 */
    private static void onDownloadFailed(final Activity activity, final String version, final String apkPath,
                                         final String sha, final long size) {
        if (!fallbackTried) {
            fallbackTried = true;
            String fb = githubFallbackUrl(version, apkPath);
            if (isAllowedUrl(fb)) {
                enqueueDownload(activity, fb, sha, size, version, apkPath);
                return;
            }
        }
        showDownloadFailed(activity, version, apkPath);
    }

    private static void showDownloadProgress(final Activity activity, final long downloadId, final BroadcastReceiver receiver,
                                             final String version, final String apkPath, final String sha, final long size) {
        final DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(activity, 20);
        box.setPadding(pad, dp(activity, 10), pad, dp(activity, 10));
        final ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        final TextView label = new TextView(activity);
        label.setGravity(Gravity.CENTER);
        label.setText("正在下载更新包…");
        box.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        box.addView(label, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        final AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("下载更新").setView(box).setCancelable(false).create();
        dialog.show();

        final Handler handler = new Handler(Looper.getMainLooper());
        final Runnable poll = new Runnable() {
            @Override public void run() {
                try {
                    DownloadManager.Query q = new DownloadManager.Query();
                    q.setFilterById(downloadId);
                    android.database.Cursor c = dm.query(q);
                    if (c != null && c.moveToFirst()) {
                        long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        long done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        c.close();
                        if (status == DownloadManager.STATUS_SUCCESSFUL) { dialog.dismiss(); return; }
                        if (status == DownloadManager.STATUS_FAILED) {
                            dialog.dismiss();
                            try { activity.unregisterReceiver(receiver); } catch (Exception ignored) {}
                            onDownloadFailed(activity, version, apkPath, sha, size);
                            return;
                        }
                        if (total > 0) {
                            int pct = (int) (done * 100 / total);
                            bar.setProgress(pct);
                            label.setText("正在下载更新包… " + pct + "%");
                        }
                        handler.postDelayed(this, 300);
                        return;
                    }
                } catch (Exception e) {
                    dialog.dismiss();
                    return;
                }
                dialog.dismiss();
            }
        };
        handler.postDelayed(poll, 300);
    }

    private static void onDownloadFinished(final Activity activity, final long downloadId, final String sha,
                                           final String version, final String apkPath, final long size) {
        try {
            DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            Uri uri = dm.getUriForDownloadedFile(downloadId);
            File target = new File(activity.getFilesDir(), "updates/steamdeals-" + version + ".apk");
            File dir = target.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();
            InputStream in = new BufferedInputStream(activity.getContentResolver().openInputStream(uri));
            OutputStream out = new FileOutputStream(target);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                digest.update(buf, 0, n);
            }
            out.flush();
            out.close();
            in.close();
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) hex.append(String.format("%02x", b));
            if (sha != null && sha.length() > 0 && !hex.toString().equalsIgnoreCase(sha.trim())) {
                target.delete();
                Toast.makeText(activity, "安装包校验失败，请重试或到下载页手动更新", Toast.LENGTH_LONG).show();
                showDownloadFailed(activity, version, apkPath);
                return;
            }
            installApk(activity, target);
        } catch (Exception e) {
            onDownloadFailed(activity, version, apkPath, sha, size);
        }
    }

    private static void showDownloadFailed(final Activity activity, final String version, final String apkPath) {
        new AlertDialog.Builder(activity)
                .setTitle("下载失败")
                .setMessage("更新包下载失败。可重试，或打开下载页手动更新。")
                .setPositiveButton("重试", (d, w) -> startDownload(activity, apkUrl(apkPath), lastExpectedSha, lastApkSize, version, apkPath))
                .setNegativeButton("打开发布页", (d, w) -> openFallbackPage(activity))
                .setCancelable(false)
                .show();
    }

    private static void installApk(final Activity activity, final File apk) {
        // Android 8+：先确认"允许安装未知应用"，否则引导去设置打开
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                new AlertDialog.Builder(activity)
                        .setTitle("需要允许安装应用")
                        .setMessage("请在设置中允许「SteamDeals」安装应用，然后回来点击重试。")
                        .setPositiveButton("去设置", (d, w) -> {
                            try {
                                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
                                activity.startActivity(intent);
                            } catch (Exception e) {
                                try {
                                    activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES));
                                } catch (Exception ignored) {}
                            }
                        })
                        .setNegativeButton("取消", null)
                        .show();
                return;
            }
        }
        // 首选 PackageInstaller 会话；失败回退 FileProvider + ACTION_VIEW
        try {
            PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = installer.createSession(params);
            PackageInstaller.Session session = installer.openSession(sessionId);
            InputStream in = new BufferedInputStream(new FileInputStream(apk));
            OutputStream out = session.openWrite("steamdeals-update.apk", 0, apk.length());
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            session.fsync(out);
            out.close();
            in.close();
            session.commit(null); // 系统弹安装确认；结果不在本批跟踪（失败由系统提示，用户可到 /app 手动更新）
            session.close();
            return;
        } catch (Exception e) {
            try {
                Uri content = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
                Intent view = new Intent(Intent.ACTION_VIEW);
                view.setDataAndType(content, "application/vnd.android.package-archive");
                view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(view);
            } catch (Exception e2) {
                Toast.makeText(activity, "无法拉起安装，请到下载页手动更新", Toast.LENGTH_LONG).show();
                openFallbackPage(activity);
            }
        }
    }

    private static void openFallbackPage(Context ctx) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(BASE_URL + "/app"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception ignored) {}
    }

    private static int dp(Context ctx, int value) {
        return Math.round(value * ctx.getResources().getDisplayMetrics().density);
    }
}
