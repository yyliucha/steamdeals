package cn.yyliucha.steamdeals;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.widget.Toast;

import java.util.ArrayList;

// BY 批（docs/MOBILE-APP-UPDATE.md §4.2）：更新对话框宿主。
// LauncherActivity 启动 TWA 后即 finish——更新弹窗必须有独立透明 Activity 承载，
// 检查在 AppUpdater 的后台线程完成后经本类的 start() 拉起。
public class UpdateDialogActivity extends Activity {
    private static final String EXTRA_VERSION = "version";
    private static final String EXTRA_VERSION_CODE = "versionCode";
    private static final String EXTRA_SIZE = "size";
    private static final String EXTRA_NOTES = "notes";
    private static final String EXTRA_APK_PATH = "apkPath";
    private static final String EXTRA_SHA = "sha256";
    private static final String EXTRA_FORCED = "forced";

    public static void start(Context context, String version, int versionCode, long size,
                             ArrayList<String> notes, String apkPath, String sha256, boolean forced) {
        Intent intent = new Intent(context, UpdateDialogActivity.class);
        intent.putExtra(EXTRA_VERSION, version);
        intent.putExtra(EXTRA_VERSION_CODE, versionCode);
        intent.putExtra(EXTRA_SIZE, size);
        intent.putStringArrayListExtra(EXTRA_NOTES, notes);
        intent.putExtra(EXTRA_APK_PATH, apkPath);
        intent.putExtra(EXTRA_SHA, sha256);
        intent.putExtra(EXTRA_FORCED, forced);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final String version = getIntent().getStringExtra(EXTRA_VERSION);
        final int versionCode = getIntent().getIntExtra(EXTRA_VERSION_CODE, -1);
        final long size = getIntent().getLongExtra(EXTRA_SIZE, -1);
        final ArrayList<String> notes = getIntent().getStringArrayListExtra(EXTRA_NOTES);
        final String apkPath = getIntent().getStringExtra(EXTRA_APK_PATH);
        final String sha = getIntent().getStringExtra(EXTRA_SHA);
        final boolean forced = getIntent().getBooleanExtra(EXTRA_FORCED, false);

        StringBuilder body = new StringBuilder();
        if (size > 0) body.append("安装包大小：").append(AppUpdater.formatSize(size)).append("\n");
        if (notes != null && !notes.isEmpty()) body.append("更新说明：\n").append(TextUtils.join("\n", notes));
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("发现新版本 v" + version)
                .setMessage(body.toString().trim())
                .setCancelable(!forced);
        if (forced) {
            b.setNegativeButton("立即更新", (d, w) -> AppUpdater.startDownload(this, apkPath, sha, size, version));
        } else {
            b.setPositiveButton("立即更新", (d, w) -> AppUpdater.startDownload(this, apkPath, sha, size, version));
            b.setNeutralButton("稍后", (d, w) -> finish());
            b.setNegativeButton("忽略此版本", (d, w) -> {
                getSharedPreferences(AppUpdater.PREFS, MODE_PRIVATE)
                        .edit().putInt(AppUpdater.KEY_IGNORED_VERSION, versionCode).apply();
                Toast.makeText(this, "已忽略 v" + version + "，出现更高版本会再提示", Toast.LENGTH_SHORT).show();
                finish();
            });
        }
        AlertDialog dialog = b.create();
        dialog.setOnDismissListener((d) -> {
            if (!AppUpdater.isDownloading()) finish(); // 下载/安装链路在自己手里时不关宿主
        });
        if (forced) dialog.setCanceledOnTouchOutside(false);
        dialog.show();
    }
}
