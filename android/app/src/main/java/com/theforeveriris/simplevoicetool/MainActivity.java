package com.theforeveriris.simplevoicetool;

import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册：bridge 初始化时才会计入插件
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(AppShortcutPlugin.class);
        registerPlugin(PrivacyLockPlugin.class);
        super.onCreate(savedInstanceState);
        // 应用锁的「禁止截屏」必须在首帧前生效；设置由 Web 层写入 SharedPreferences
        if (getSharedPreferences("svt_security", MODE_PRIVATE).getBoolean("secure_screen", false)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        // 冷启动即带分享 intent 的情形（应用未在后台时「分享到」）
        ShareTargetPlugin.handleIntent(this, getIntent());
        // 冷启动即带快捷方式 intent 的情形：路由暂存，等 Web 层 getInitialRoute() 取走
        AppShortcutPlugin.handleIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // singleTask：应用已在后台时再次「分享到」走这里
        ShareTargetPlugin.handleIntent(this, intent);
        // 应用在后台时长按快捷方式：推 shortcutRoute 事件切页签
        AppShortcutPlugin.handleIntent(intent);
    }
}
