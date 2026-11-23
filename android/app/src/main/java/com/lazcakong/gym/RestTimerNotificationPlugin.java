package com.lazcakong.gym;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Native Android rest timer countdown notification plugin for LAZCAKONG GYM.
 *
 * Uses Android's native chronometer countdown (setUsesChronometer + setChronometerCountDown + setWhen)
 * rendered directly by SystemUI in the shade, status bar, and lock screen (VISIBILITY_PUBLIC),
 * with zero per-second JS polling loops, interactive shade actions (Pause / Resume / +15s / Skip),
 * exact AlarmManager wakeups, Android 16 Promoted Ongoing requests, and Android 14+ Full-Screen
 * visual lock-screen completion alerts.
 */
@CapacitorPlugin(
    name = "RestTimerNotification",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class RestTimerNotificationPlugin extends Plugin {

    public static final String CHANNEL_ID = RestTimerNotificationHelper.CHANNEL_ONGOING_ID;
    public static final int REST_ONGOING_NOTIFICATION_ID = RestTimerNotificationHelper.REST_ONGOING_NOTIFICATION_ID;
    public static final String EXTRA_OPEN_ACTIVE_WORKOUT = RestTimerNotificationHelper.EXTRA_OPEN_ACTIVE_WORKOUT;
    public static final String EXTRA_REST_ID = RestTimerNotificationHelper.EXTRA_REST_ID;

    private static volatile RestTimerNotificationPlugin activeInstance = null;
    private static volatile boolean hostInForeground = true;
    private static volatile boolean pendingOpenActiveWorkout = false;
    private static volatile String pendingRestId = "";

    @Override
    public void load() {
        super.load();
        activeInstance = this;
        hostInForeground = true;
        RestTimerNotificationHelper.ensureChannels(getContext());
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        hostInForeground = true;
        notifyStateChangedFromNative(getContext());
    }

    @Override
    protected void handleOnPause() {
        hostInForeground = false;
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        hostInForeground = false;
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.handleOnDestroy();
    }

    public static boolean isHostInForeground() {
        return hostInForeground;
    }

    public static void handleLaunchIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        boolean shouldOpen = intent.getBooleanExtra(EXTRA_OPEN_ACTIVE_WORKOUT, false);
        if (!shouldOpen) {
            return;
        }
        String restId = intent.getStringExtra(EXTRA_REST_ID);
        if (restId == null) {
            restId = "";
        }
        intent.removeExtra(EXTRA_OPEN_ACTIVE_WORKOUT);
        intent.removeExtra(EXTRA_REST_ID);

        RestTimerNotificationPlugin instance = activeInstance;
        if (instance != null && instance.hasListeners("openActiveWorkout")) {
            JSObject payload = new JSObject();
            payload.put("openActiveWorkout", true);
            payload.put("restId", restId);
            instance.notifyListeners("openActiveWorkout", payload, true);
        } else {
            pendingOpenActiveWorkout = true;
            pendingRestId = restId;
        }
    }

    public static void notifyStateChangedFromNative(Context context) {
        RestTimerNotificationPlugin instance = activeInstance;
        if (context == null || instance == null) {
            return;
        }
        if (!instance.hasListeners("restTimerStateSynced")) {
            return;
        }
        RestTimerStore.StateSnapshot snapshot = RestTimerStore.getSnapshot(context);
        instance.notifyListeners("restTimerStateSynced", snapshot.toJSObject(), true);
    }

    /**
     * Builds the ongoing rest notification builder.
     * IMPORTANT for Honor MagicOS: Do NOT call .setSilent(true) because MagicOS treats silent
     * ongoing notifications as low-priority and hides them from the lock screen by default.
     * Instead, CHANNEL_ONGOING_ID already has null sound and zero vibration at IMPORTANCE_DEFAULT
     * with VISIBILITY_PUBLIC and setOnlyAlertOnce(true).
     */
    public static NotificationCompat.Builder buildOngoingCountdownBuilder(
        Context context,
        RestTimerStore.StateSnapshot state,
        String customTitle,
        String customBody,
        String shortText
    ) {
        long now = System.currentTimeMillis();
        long targetEndTime = state.paused ? now : state.targetEndTime;
        long remainingMs = state.paused
            ? Math.max(1000L, state.remainingSeconds * 1000L)
            : Math.max(1000L, targetEndTime - now);
        int remainingSec = Math.max(1, (int) Math.ceil(remainingMs / 1000.0));

        String cleanExercise = state.exerciseName != null ? state.exerciseName.trim() : "";
        String defaultTitle;
        if (state.paused) {
            defaultTitle = "LazcaKong Gym · Descanso en pausa (" + RestTimerNotificationHelper.formatMmSs(remainingSec) + ")";
        } else {
            int labelSeconds = Math.max(state.totalSeconds, remainingSec);
            defaultTitle = "LazcaKong Gym · Descanso de " + RestTimerNotificationHelper.formatDurationLabel(labelSeconds);
        }

        String defaultBody;
        if (!cleanExercise.isEmpty() && state.nextSetNumber > 0) {
            defaultBody = state.paused
                ? "En pausa · " + cleanExercise + " (Serie " + state.nextSetNumber + ")"
                : "Siguiente serie: " + cleanExercise + " (Serie " + state.nextSetNumber + ")";
        } else if (!cleanExercise.isEmpty()) {
            defaultBody = state.paused
                ? "En pausa · " + cleanExercise
                : "Siguiente ejercicio: " + cleanExercise;
        } else {
            defaultBody = state.paused
                ? "Temporizador en pausa · Toca para reanudar"
                : "Descanso en curso · Toca para volver a Entrenar";
        }

        String title = (customTitle != null && !customTitle.trim().isEmpty()) ? customTitle.trim() : defaultTitle;
        String body = (customBody != null && !customBody.trim().isEmpty()) ? customBody.trim() : defaultBody;
        String chipLabel = (shortText != null && !shortText.trim().isEmpty())
            ? shortText.trim()
            : (state.paused ? "Pausa" : "Descanso");

        PendingIntent contentIntent = RestTimerNotificationHelper.createOpenActiveWorkoutPendingIntent(
            context,
            REST_ONGOING_NOTIFICATION_ID,
            state.restId
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
            context,
            RestTimerNotificationHelper.CHANNEL_ONGOING_ID
        )
            .setSmallIcon(R.drawable.ic_stat_lazcakong)
            .setColor(Color.parseColor("#CCFF00"))
            .setColorized(false)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(contentIntent);

        if (state.paused) {
            builder
                .setShowWhen(false)
                .setUsesChronometer(false)
                .setChronometerCountDown(false);
        } else {
            // Live system countdown chronometer bound to exact wall-clock targetEndTime
            builder
                .setWhen(targetEndTime)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setTimeoutAfter(remainingMs);
        }

        try {
            Bitmap largeIcon = BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher);
            if (largeIcon != null) {
                builder.setLargeIcon(largeIcon);
            }
        } catch (Throwable ignored) {
        }

        // Interactive notification actions usable directly from lock screen & notification shade
        if (state.paused) {
            builder.addAction(
                0,
                "Reanudar",
                RestTimerNotificationHelper.createActionBroadcastPendingIntent(
                    context,
                    RestTimerNotificationHelper.ACTION_RESUME,
                    77201
                )
            );
        } else {
            builder.addAction(
                0,
                "Pausar",
                RestTimerNotificationHelper.createActionBroadcastPendingIntent(
                    context,
                    RestTimerNotificationHelper.ACTION_PAUSE,
                    77202
                )
            );
        }
        builder.addAction(
            0,
            "+15s",
            RestTimerNotificationHelper.createActionBroadcastPendingIntent(
                context,
                RestTimerNotificationHelper.ACTION_ADD_15S,
                77203
            )
        );
        builder.addAction(
            0,
            "Saltar",
            RestTimerNotificationHelper.createActionBroadcastPendingIntent(
                context,
                RestTimerNotificationHelper.ACTION_SKIP,
                77204
            )
        );

        // Request Android 16 Promoted Ongoing Live Update chip (setRequestPromotedOngoing + setShortCriticalText)
        if (!state.paused) {
            RestTimerNotificationHelper.applyPromotedOngoingIfSupported(builder, chipLabel);
        }

        return builder;
    }

    @PluginMethod
    public void startOrUpdate(PluginCall call) {
        Context context = getContext();
        if (!RestTimerNotificationHelper.hasNotificationPermission(context)) {
            JSObject denied = new JSObject();
            denied.put("shown", false);
            denied.put("reason", "permission_denied");
            call.resolve(denied);
            return;
        }

        Long targetEndTimeObj = call.getLong("targetEndTime");
        long now = System.currentTimeMillis();
        if (targetEndTimeObj == null || targetEndTimeObj <= now) {
            JSObject invalid = new JSObject();
            invalid.put("shown", false);
            invalid.put("reason", "invalid_target_end_time");
            call.resolve(invalid);
            return;
        }

        long targetEndTime = targetEndTimeObj;
        int totalSeconds = call.getInt("totalSeconds", Math.max(1, (int) Math.ceil((targetEndTime - now) / 1000.0)));
        String title = call.getString("title", null);
        String body = call.getString("body", null);
        String shortText = call.getString("shortText", "Descanso");
        String restId = call.getString("restId", "");
        String exerciseName = call.getString("exerciseName", "");
        int nextSetNumber = call.getInt("nextSetNumber", 0);
        String mode = call.getString("mode", "sound");
        boolean restEndAlertEnabled = call.getBoolean("restEndAlertEnabled", true);

        RestTimerStore.StateSnapshot state = RestTimerStore.saveRunningFromApp(
            context,
            restId,
            targetEndTime,
            totalSeconds,
            exerciseName,
            nextSetNumber,
            mode,
            restEndAlertEnabled
        );

        RestTimerNotificationHelper.cancelCompleteNotification(context);
        boolean exactScheduled = RestTimerNotificationHelper.scheduleExactAlarm(
            context,
            state.targetEndTime,
            state.restId,
            state.exerciseName,
            state.nextSetNumber
        );

        boolean shown = RestTimerNotificationHelper.showOngoingNotification(
            context,
            state,
            title,
            body,
            shortText
        );

        JSObject caps = RestTimerNotificationHelper.buildCapabilities(context);
        JSObject res = new JSObject();
        res.put("shown", shown);
        res.put("notificationId", REST_ONGOING_NOTIFICATION_ID);
        res.put("targetEndTime", state.targetEndTime);
        res.put("exactAlarmScheduled", exactScheduled);
        res.put("promotedRequested", Build.VERSION.SDK_INT >= 36);
        res.put("canPostPromoted", caps.optBoolean("canPostPromoted", false));
        res.put("hasPromotableCharacteristics", caps.optBoolean("hasPromotableCharacteristics", false));
        res.put("canScheduleExactAlarms", caps.optBoolean("canScheduleExactAlarms", false));
        res.put("canUseFullScreenIntent", caps.optBoolean("canUseFullScreenIntent", false));
        call.resolve(res);
    }

    @PluginMethod
    public void pauseOngoing(PluginCall call) {
        Context context = getContext();
        int remainingSeconds = Math.max(1, call.getInt("remainingSeconds", 60));
        int totalSeconds = Math.max(remainingSeconds, call.getInt("totalSeconds", remainingSeconds));
        String exerciseName = call.getString("exerciseName", "");
        int nextSetNumber = call.getInt("nextSetNumber", 0);
        String mode = call.getString("mode", "sound");
        boolean restEndAlertEnabled = call.getBoolean("restEndAlertEnabled", true);
        String title = call.getString("title", null);
        String body = call.getString("body", null);

        RestTimerStore.StateSnapshot state = RestTimerStore.savePausedFromApp(
            context,
            remainingSeconds,
            totalSeconds,
            exerciseName,
            nextSetNumber,
            mode,
            restEndAlertEnabled
        );
        RestTimerNotificationHelper.cancelExactAlarm(context);
        boolean shown = RestTimerNotificationHelper.showOngoingNotification(
            context,
            state,
            title,
            body,
            "Pausa"
        );

        JSObject res = new JSObject();
        res.put("paused", true);
        res.put("shown", shown);
        res.put("remainingSeconds", state.remainingSeconds);
        call.resolve(res);
    }

    @PluginMethod
    public void cancelOngoing(PluginCall call) {
        Context context = getContext();
        boolean preserveStore = Boolean.TRUE.equals(call.getBoolean("preserveStore", false));
        if (!preserveStore) {
            RestTimerStore.clearFromApp(context);
            RestTimerNotificationHelper.cancelExactAlarm(context);
        }
        RestTimerNotificationHelper.cancelOngoingNotification(context);

        JSObject res = new JSObject();
        res.put("cancelled", true);
        call.resolve(res);
    }

    @PluginMethod
    public void cancelAllRest(PluginCall call) {
        Context context = getContext();
        RestTimerStore.clearFromApp(context);
        RestTimerNotificationHelper.cancelExactAlarm(context);
        RestTimerNotificationHelper.cancelOngoingNotification(context);
        RestTimerNotificationHelper.cancelCompleteNotification(context);

        JSObject res = new JSObject();
        res.put("cancelled", true);
        call.resolve(res);
    }

    @PluginMethod
    public void markCompletedFromApp(PluginCall call) {
        Context context = getContext();
        String restId = call.getString("restId", "");
        Long targetEndTimeObj = call.getLong("targetEndTime");
        long targetEndTime = targetEndTimeObj != null ? targetEndTimeObj : 0L;
        String exerciseName = call.getString("exerciseName", "");
        int nextSetNumber = call.getInt("nextSetNumber", 0);
        String mode = call.getString("mode", "sound");
        boolean restEndAlertEnabled = call.getBoolean("restEndAlertEnabled", true);

        RestTimerNotificationHelper.triggerRestComplete(
            context,
            restId,
            targetEndTime,
            exerciseName,
            nextSetNumber,
            mode,
            restEndAlertEnabled,
            false
        );

        JSObject res = new JSObject();
        res.put("completed", true);
        call.resolve(res);
    }

    @PluginMethod
    public void getNativeState(PluginCall call) {
        RestTimerStore.StateSnapshot state = RestTimerStore.getSnapshot(getContext());
        call.resolve(state.toJSObject());
    }

    @PluginMethod
    public void consumePendingNativeSync(PluginCall call) {
        Context context = getContext();
        RestTimerStore.StateSnapshot state = RestTimerStore.getSnapshot(context);
        JSObject obj = state.toJSObject();
        RestTimerStore.consumePendingAction(context);
        call.resolve(obj);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        Context context = getContext();
        RestTimerNotificationHelper.ensureChannels(context);
        if (Build.VERSION.SDK_INT >= 33 && !RestTimerNotificationHelper.isPostNotificationsGranted(context)) {
            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback");
            return;
        }
        call.resolve(RestTimerNotificationHelper.buildCapabilities(context));
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        Context context = getContext();
        RestTimerNotificationHelper.ensureChannels(context);
        JSObject caps = RestTimerNotificationHelper.buildCapabilities(context);
        PermissionState capPerm = getPermissionState("notifications");
        caps.put("capacitorPermissionState", capPerm != null ? capPerm.toString() : "UNKNOWN");
        call.resolve(caps);
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        call.resolve(RestTimerNotificationHelper.buildCapabilities(getContext()));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context context = getContext();
        Intent primary;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            primary = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            primary.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else {
            primary = RestTimerNotificationHelper.buildAppDetailsIntent(context);
        }
        boolean opened = RestTimerNotificationHelper.openSettingsIntent(
            context,
            primary,
            RestTimerNotificationHelper.buildAppDetailsIntent(context)
        );
        JSObject res = new JSObject();
        res.put("opened", opened);
        call.resolve(res);
    }

    @PluginMethod
    public void openChannelSettings(PluginCall call) {
        Context context = getContext();
        RestTimerNotificationHelper.ensureChannels(context);
        String channelId = call.getString("channelId", CHANNEL_ID);
        Intent primary;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            primary = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            primary.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            primary.putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
        } else {
            primary = RestTimerNotificationHelper.buildAppDetailsIntent(context);
        }
        Intent fallback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName())
            : RestTimerNotificationHelper.buildAppDetailsIntent(context);
        boolean opened = RestTimerNotificationHelper.openSettingsIntent(context, primary, fallback);
        JSObject res = new JSObject();
        res.put("opened", opened);
        call.resolve(res);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Context context = getContext();
        Intent primary = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            primary = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            primary.setData(Uri.parse("package:" + context.getPackageName()));
        }
        boolean opened = RestTimerNotificationHelper.openSettingsIntent(
            context,
            primary,
            RestTimerNotificationHelper.buildAppDetailsIntent(context)
        );
        JSObject res = new JSObject();
        res.put("opened", opened);
        call.resolve(res);
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        Context context = getContext();
        Intent primary = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            primary = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        }
        boolean opened = RestTimerNotificationHelper.openSettingsIntent(
            context,
            primary,
            RestTimerNotificationHelper.buildAppDetailsIntent(context)
        );
        JSObject res = new JSObject();
        res.put("opened", opened);
        call.resolve(res);
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        Context context = getContext();
        Intent primary = null;
        if (Build.VERSION.SDK_INT >= 34) {
            primary = new Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT");
            primary.setData(Uri.parse("package:" + context.getPackageName()));
        }
        Intent fallback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName())
            : RestTimerNotificationHelper.buildAppDetailsIntent(context);
        boolean opened = RestTimerNotificationHelper.openSettingsIntent(context, primary, fallback);
        JSObject res = new JSObject();
        res.put("opened", opened);
        call.resolve(res);
    }

    @PluginMethod
    public void openMagicOsAutostartSettings(PluginCall call) {
        Context context = getContext();
        Intent honorStartup = RestTimerNotificationHelper.resolveMagicOsStartupIntent(context);
        boolean usedVendorScreen = honorStartup != null;
        boolean opened = RestTimerNotificationHelper.openSettingsIntent(
            context,
            honorStartup,
            RestTimerNotificationHelper.buildAppDetailsIntent(context)
        );
        JSObject res = new JSObject();
        res.put("opened", opened);
        res.put("usedVendorScreen", usedVendorScreen);
        call.resolve(res);
    }

    @PluginMethod
    public void consumePendingOpenActiveWorkout(PluginCall call) {
        JSObject res = new JSObject();
        res.put("shouldOpen", pendingOpenActiveWorkout);
        res.put("restId", pendingRestId);
        pendingOpenActiveWorkout = false;
        pendingRestId = "";
        call.resolve(res);
    }
}
