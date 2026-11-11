package com.theforeveriris.simplevoicetool;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 应用锁的原生能力：
 * - BiometricPrompt：强生物识别可重置 PIN，弱生物识别只解锁；
 * - FLAG_SECURE：禁止截屏 / 最近任务预览（设置持久化到 SharedPreferences）；
 * - 低调模式：在 4 个 activity-alias 之间切换 launcher 名称/图标；
 * - onPause / onResume 事件：Web 层据此计算 5 分钟后台自动锁。
 */
@CapacitorPlugin(name = "PrivacyLock")
public class PrivacyLockPlugin extends Plugin {

    private static final String PREFS = "svt_security";
    private static final String PREF_SECURE = "secure_screen";
    private static final String[] ALIASES = {
        ".LauncherNormal",
        ".LauncherVoiceNotes",
        ".LauncherVocalLog",
        ".LauncherAudioJournal",
    };

    private BiometricPrompt prompt;
    private PluginCall pendingCall;

    @PluginMethod
    public void getBiometricAvailability(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        JSObject result = new JSObject();
        result.put("strong", manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("weak", manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
            == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(result);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        final FragmentActivity activity = (FragmentActivity) getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        if (pendingCall != null) {
            pendingCall.reject("superseded");
            pendingCall = null;
        }
        pendingCall = call;

        final boolean strong = call.getBoolean("strong", false);
        final String title = call.getString("title", "Unlock");
        final String subtitle = call.getString("subtitle", "");
        final String cancel = call.getString("cancel", "Cancel");

        activity.runOnUiThread(() -> {
            try {
                prompt = new BiometricPrompt(
                    activity,
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            resolvePending(false, String.valueOf(errorCode));
                        }

                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            resolvePending(true, null);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // 留在系统弹窗里继续重试；失败次数由系统处理
                        }
                    }
                );

                BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(strong
                        ? BiometricManager.Authenticators.BIOMETRIC_STRONG
                        : BiometricManager.Authenticators.BIOMETRIC_WEAK)
                    .setConfirmationRequired(false);
                if (cancel != null && !cancel.isEmpty()) {
                    builder.setNegativeButtonText(cancel);
                }
                prompt.authenticate(builder.build());
            } catch (Exception error) {
                resolvePending(false, error.getMessage());
            }
        });
    }

    private void resolvePending(boolean success, String error) {
        PluginCall call = pendingCall;
        pendingCall = null;
        prompt = null;
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("success", success);
        if (error != null) result.put("error", error);
        call.resolve(result);
    }

    @PluginMethod
    public void cancelAuthentication(PluginCall call) {
        if (prompt != null) {
            prompt.cancelAuthentication();
            prompt = null;
        }
        resolvePending(false, "canceled");
        call.resolve();
    }

    @PluginMethod
    public void setSecureFlag(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", false);
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(PREF_SECURE, enabled).apply();

        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (enabled) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setDiscreetPreset(PluginCall call) {
        String preset = call.getString("preset", "normal");
        String selected;
        switch (preset) {
            case "voiceNotes":
                selected = ".LauncherVoiceNotes";
                break;
            case "vocalLog":
                selected = ".LauncherVocalLog";
                break;
            case "audioJournal":
                selected = ".LauncherAudioJournal";
                break;
            default:
                selected = ".LauncherNormal";
                break;
        }

        PackageManager manager = getContext().getPackageManager();
        for (String alias : ALIASES) {
            ComponentName component = new ComponentName(
                getContext().getPackageName(),
                getContext().getPackageName() + alias
            );
            int state = alias.equals(selected)
                ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
            manager.setComponentEnabledSetting(
                component,
                state,
                PackageManager.DONT_KILL_APP
            );
        }
        call.resolve();
    }

    @PluginMethod
    public void restartApp(PluginCall call) {
        call.resolve();
        Context context = getContext();
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }
        if (getActivity() != null) {
            getActivity().finishAffinity();
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        notifyListeners("appPaused", new JSObject());
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("appResumed", new JSObject());
    }
}
