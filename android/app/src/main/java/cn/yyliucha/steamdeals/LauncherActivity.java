/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package cn.yyliucha.steamdeals;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;



public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    

    

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
        // BY 批（docs/MOBILE-APP-UPDATE.md §4.1/§4.5）：启动时检查更新（不节流、失败静默不阻塞进站）；
        // 经自定义 scheme 唤起（launchMode=singleTop 新实例路径）时按手动检查处理（不写节流时间）。
        boolean manualByScheme = isCheckUpdateIntent(getIntent());
        AppUpdater.checkForUpdate(this, false, manualByScheme);
    }

    private static boolean isCheckUpdateIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        return data != null && "steamdeals".equals(data.getScheme()) && "check-update".equals(data.getHost());
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 回前台检查：24 小时最多一次（手动入口与启动不受节流）
        AppUpdater.checkForUpdate(this, true, false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // BY-3（§4.5）：「我的 → 检查更新」用自定义 scheme 拉起本 Activity（launchMode=singleTop）
        if (isCheckUpdateIntent(intent)) {
            AppUpdater.checkForUpdate(this, false, true);
        }
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url.
        Uri uri = super.getLaunchingUrl();

        

        return uri;
    }
}
