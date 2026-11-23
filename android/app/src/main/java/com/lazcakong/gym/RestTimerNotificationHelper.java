package com.lazcakong.gym;

import android.Manifest;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Unified native Android notification, countdown chronometer, Android 16 Live Update,
 * exact AlarmManager scheduling, and lockscreen alert helper for LAZCAKONG GYM.
 */
public final class RestTimerNotificationHelper {

    public static final String CHANNEL_ONGOING_ID = "lazcakong_rest_chronometer_v2";
    public static final String LEGACY_CHANNEL_ONGOING_ID = "lazcakong_rest_live_countdown";
    public static final String CHANNEL_FINISH_SOUND_ID = "lazcakong_rest_finish_sound_v2";
    public static final String CHANNEL_FINISH_VIBRATE_ID = "lazcakong_rest_finish_vibrate_v2";
    public static final String CHANNEL_FINISH_SILENT_ID = "lazcakong_rest_finish_silent_v2";

    public static final int REST_ONGOING_NOTIFICATION_ID = 77001;
    public static final int REST_COMPLETE_NOTIFICATION_ID = 77002;
    public static final int ALARM_REQUEST_CODE = 77101;

    public static final String EXTRA_OPEN_ACTIVE_WORKOUT = "lazcakong_open_active_workout";
    public static final String EXTRA_REST_ID = "lazcakong_rest_id";
    public static final String EXTRA_TARGET_END_TIME = "lazcakong_target_end_time";
    public static final String EXTRA_EXERCISE_NAME = "lazcakong_exercise_name";
    public static final String EXTRA_NEXT_SET_NUMBER = "lazcakong_next_set_number";

    public static final String ACTION_PAUSE = "com.lazcakong.gym.ACTION_REST_PAUSE";
    public static final String ACTION_RESUME = "com.lazcakong.gym.ACTION_REST_RESUME";
    public static final String ACTION_ADD_15S = "com.lazcakong.gym.ACTION_REST_ADD_15S";
    public static final String ACTION_SKIP = "com.lazcakong.gym.ACTION_REST_SKIP";
    public static final String ACTION_DISMISS_COMPLETE = "com.lazcakong.gym.ACTION_REST_DISMISS_COMPLETE";

    private static final long[] REST_COMPLETE_VIBRATION_PATTERN = new long[]{0L, 600L, 250L, 600L, 250L, 600L};

    private static final ComponentName[] HONOR_HUAWEI_STARTUP_COMPONENTS = new ComponentName[]{
        new ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity"),
        new ComponentName("com.hihonor.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
        new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
    };

    private static volatile boolean lastNotificationPromotableCharacteristics = false;

    private RestTimerNotificationHelper() {}

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context == null) {
            return;
        }
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        // Remove legacy v1 ongoing channel if present so Honor settings show a single clean channel.
        if (manager.getNotificationChannel(LEGACY_CHANNEL_ONGOING_ID) != null) {
            try {
                manager.deleteNotificationChannel(LEGACY_CHANNEL_ONGOING_ID);
            } catch (Throwable ignored) {
            }
        }

        if (manager.getNotificationChannel(CHANNEL_ONGOING_ID) == null) {
            // IMPORTANCE_DEFAULT + null sound + no vibration keeps the countdown silent on updates
            // while remaining eligible for lock-screen visibility and status-bar display on MagicOS.
            NotificationChannel ongoing = new NotificationChannel(
                CHANNEL_ONGOING_ID,
                "Descanso en curso (Cronómetro)",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            ongoing.setDescription(
                "Muestra el cronómetro regresivo de descanso en la barra superior, panel y pantalla de bloqueo."
            );
            ongoing.setSound(null, null);
            ongoing.enableVibration(false);
            ongoing.enableLights(false);
            ongoing.setShowBadge(false);
            ongoing.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(ongoing);
        }

        if (manager.getNotificationChannel(CHANNEL_FINISH_SOUND_ID) == null) {
            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (soundUri == null) {
                soundUri = Settings.System.DEFAULT_NOTIFICATION_URI;
            }
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

            NotificationChannel finishSound = new NotificationChannel(
                CHANNEL_FINISH_SOUND_ID,
                "Fin de descanso (Alerta con sonido)",
                NotificationManager.IMPORTANCE_HIGH
            );
            finishSound.setDescription(
                "Alerta prioritaria con sonido, vibración y aviso visual al terminar el descanso."
            );
            finishSound.setSound(soundUri, audioAttrs);
            finishSound.enableVibration(true);
            finishSound.setVibrationPattern(REST_COMPLETE_VIBRATION_PATTERN);
            finishSound.enableLights(true);
            finishSound.setLightColor(Color.parseColor("#CCFF00"));
            finishSound.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(finishSound);
        }

        if (manager.getNotificationChannel(CHANNEL_FINISH_VIBRATE_ID) == null) {
            NotificationChannel finishVibrate = new NotificationChannel(
                CHANNEL_FINISH_VIBRATE_ID,
                "Fin de descanso (Solo vibración)",
                NotificationManager.IMPORTANCE_HIGH
            );
            finishVibrate.setDescription(
                "Alerta prioritaria con vibración y aviso visual al terminar el descanso sin sonido."
            );
            finishVibrate.setSound(null, null);
            finishVibrate.enableVibration(true);
            finishVibrate.setVibrationPattern(REST_COMPLETE_VIBRATION_PATTERN);
            finishVibrate.enableLights(true);
            finishVibrate.setLightColor(Color.parseColor("#CCFF00"));
            finishVibrate.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(finishVibrate);
        }

        if (manager.getNotificationChannel(CHANNEL_FINISH_SILENT_ID) == null) {
            NotificationChannel finishSilent = new NotificationChannel(
                CHANNEL_FINISH_SILENT_ID,
                "Fin de descanso (Silencio)",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            finishSilent.setDescription(
                "Aviso visual silencioso al finalizar el descanso."
            );
            finishSilent.setSound(null, null);
            finishSilent.enableVibration(false);
            finishSilent.enableLights(false);
            finishSilent.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(finishSilent);
        }
    }

    public static boolean isPostNotificationsGranted(Context context) {
        if (context == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    public static boolean hasNotificationPermission(Context context) {
        if (context == null) {
            return false;
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false;
        }
        return isPostNotificationsGranted(context);
    }

    public static boolean canScheduleExactAlarmsSafe(Context context) {
        if (context == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return false;
        }
        try {
            return alarmManager.canScheduleExactAlarms();
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static boolean canUseFullScreenIntentSafe(Context context) {
        if (context == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT < 34) {
            return true;
        }
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return false;
        }
        try {
            Method m = NotificationManager.class.getMethod("canUseFullScreenIntent");
            Object res = m.invoke(manager);
            return Boolean.TRUE.equals(res);
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static boolean canPostPromotedNotificationsSafe(NotificationManager manager) {
        if (manager == null || Build.VERSION.SDK_INT < 36) {
            return false;
        }
        try {
            Method m = NotificationManager.class.getMethod("canPostPromotedNotifications");
            Object result = m.invoke(manager);
            return Boolean.TRUE.equals(result);
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static boolean hasPromotableCharacteristicsSafe(Notification notification) {
        if (notification == null || Build.VERSION.SDK_INT < 36) {
            return false;
        }
        try {
            Method m = Notification.class.getMethod("hasPromotableCharacteristics");
            Object result = m.invoke(notification);
            return Boolean.TRUE.equals(result);
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static boolean isIgnoringBatteryOptimizationsSafe(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm == null) {
            return false;
        }
        try {
            return pm.isIgnoringBatteryOptimizations(context.getPackageName());
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static boolean applyPromotedOngoingIfSupported(
        NotificationCompat.Builder builder,
        String shortText
    ) {
        boolean applied = false;
        try {
            Method reqMethod =
                NotificationCompat.Builder.class.getMethod("setRequestPromotedOngoing", boolean.class);
            reqMethod.invoke(builder, true);
            applied = true;
        } catch (Throwable ignored) {
            // Fallback via Android 16 bundle extra below
        }

        if (shortText != null && !shortText.trim().isEmpty()) {
            String trimmed = shortText.trim();
            if (trimmed.length() > 14) {
                trimmed = trimmed.substring(0, 14).trim();
            }
            try {
                Method shortMethod =
                    NotificationCompat.Builder.class.getMethod("setShortCriticalText", CharSequence.class);
                shortMethod.invoke(builder, trimmed);
            } catch (Throwable ignored) {
                try {
                    Method shortStrMethod =
                        NotificationCompat.Builder.class.getMethod("setShortCriticalText", String.class);
                    shortStrMethod.invoke(builder, trimmed);
                } catch (Throwable ignoredAgain) {
                    // Older AndroidX
                }
            }
        }

        if (Build.VERSION.SDK_INT >= 36) {
            Bundle extras = new Bundle();
            extras.putBoolean("android.requestPromotedOngoing", true);
            builder.addExtras(extras);
            applied = true;
        }
        return applied;
    }

    public static void setLastNotificationPromotableCharacteristics(boolean promotable) {
        lastNotificationPromotableCharacteristics = promotable;
    }

    public static PendingIntent createOpenActiveWorkoutPendingIntent(
        Context context,
        int requestCode,
        String restId
    ) {
        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra(EXTRA_OPEN_ACTIVE_WORKOUT, true);
        openIntent.putExtra(EXTRA_REST_ID, restId != null ? restId : "");

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, requestCode, openIntent, flags);
    }

    public static PendingIntent createActionBroadcastPendingIntent(
        Context context,
        String action,
        int requestCode
    ) {
        Intent intent = new Intent(context, RestTimerActionReceiver.class);
        intent.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    public static boolean showOngoingNotification(
        Context context,
        RestTimerStore.StateSnapshot state,
        String customTitle,
        String customBody,
        String shortText
    ) {
        if (context == null || state == null || !state.active) {
            return false;
        }
        if (!hasNotificationPermission(context)) {
            return false;
        }

        ensureChannels(context);
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return false;
        }

        long now = System.currentTimeMillis();
        if (!state.paused && state.targetEndTime <= now) {
            return false;
        }

        NotificationCompat.Builder builder = RestTimerNotificationPlugin.buildOngoingCountdownBuilder(
            context,
            state,
            customTitle,
            customBody,
            shortText
        );
        Notification built = builder.build();
        if (!state.paused) {
            lastNotificationPromotableCharacteristics = hasPromotableCharacteristicsSafe(built);
        }
        manager.notify(REST_ONGOING_NOTIFICATION_ID, built);
        return true;
    }

    public static void cancelOngoingNotification(Context context) {
        if (context == null) {
            return;
        }
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(REST_ONGOING_NOTIFICATION_ID);
        }
    }

    public static void cancelCompleteNotification(Context context) {
        if (context == null) {
            return;
        }
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(REST_COMPLETE_NOTIFICATION_ID);
        }
    }

    public static boolean scheduleExactAlarm(
        Context context,
        long targetEndTime,
        String restId,
        String exerciseName,
        int nextSetNumber
    ) {
        if (context == null || targetEndTime <= System.currentTimeMillis()) {
            return false;
        }
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return false;
        }

        Intent alarmIntent = new Intent(context, RestAlarmReceiver.class);
        alarmIntent.putExtra(EXTRA_REST_ID, restId != null ? restId : "");
        alarmIntent.putExtra(EXTRA_TARGET_END_TIME, targetEndTime);
        alarmIntent.putExtra(EXTRA_EXERCISE_NAME, exerciseName != null ? exerciseName : "");
        alarmIntent.putExtra(EXTRA_NEXT_SET_NUMBER, nextSetNumber);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, alarmIntent, flags);

        boolean canExact = canScheduleExactAlarmsSafe(context);
        try {
            if (canExact) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, targetEndTime, pi);
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, targetEndTime, pi);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, targetEndTime, pi);
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, targetEndTime, pi);
            }
            return true;
        } catch (SecurityException se) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, targetEndTime, pi);
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, targetEndTime, pi);
            }
            return false;
        }
    }

    public static void cancelExactAlarm(Context context) {
        if (context == null) {
            return;
        }
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }
        Intent alarmIntent = new Intent(context, RestAlarmReceiver.class);
        int flags = PendingIntent.FLAG_NO_CREATE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, alarmIntent, flags);
        if (pi != null) {
            alarmManager.cancel(pi);
            pi.cancel();
        }
    }

    public static void triggerRestComplete(
        Context context,
        String restId,
        long targetEndTime,
        String exerciseName,
        int nextSetNumber,
        String mode,
        boolean restEndAlertEnabled,
        boolean fromNativeAlarm
    ) {
        if (context == null) {
            return;
        }
        boolean claimed = RestTimerStore.tryClaimCompletion(context, restId, targetEndTime, fromNativeAlarm);
        cancelOngoingNotification(context);
        cancelExactAlarm(context);
        if (!claimed) {
            return;
        }

        boolean isSilentMode = "silent".equals(mode);
        if (fromNativeAlarm && !isSilentMode) {
            triggerAlarmVibration(context);
        }

        if (!restEndAlertEnabled) {
            return;
        }

        if (!hasNotificationPermission(context)) {
            return;
        }

        ensureChannels(context);
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        String channelId;
        int priority;
        if ("silent".equals(mode)) {
            channelId = CHANNEL_FINISH_SILENT_ID;
            priority = NotificationCompat.PRIORITY_DEFAULT;
        } else if ("vibrate_only".equals(mode)) {
            channelId = CHANNEL_FINISH_VIBRATE_ID;
            priority = NotificationCompat.PRIORITY_MAX;
        } else {
            channelId = CHANNEL_FINISH_SOUND_ID;
            priority = NotificationCompat.PRIORITY_MAX;
        }

        String cleanExercise = exerciseName != null ? exerciseName.trim() : "";
        String body = (!cleanExercise.isEmpty() && nextSetNumber > 0)
            ? "Siguiente serie: " + cleanExercise + " · Serie " + nextSetNumber
            : "Descanso finalizado. Continúa tu entrenamiento.";

        PendingIntent contentIntent = createOpenActiveWorkoutPendingIntent(
            context,
            REST_COMPLETE_NOTIFICATION_ID,
            restId
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_lazcakong)
            .setColor(Color.parseColor("#CCFF00"))
            .setContentTitle("LAZCAKONG · DESCANSO TERMINADO")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(priority)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(contentIntent)
            .addAction(0, "Continuar entrenamiento", contentIntent)
            .addAction(
                0,
                "Cerrar",
                createActionBroadcastPendingIntent(context, ACTION_DISMISS_COMPLETE, 77205)
            );

        try {
            Bitmap largeIcon = BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher);
            if (largeIcon != null) {
                builder.setLargeIcon(largeIcon);
            }
        } catch (Throwable ignored) {
        }

        if (!isSilentMode && fromNativeAlarm) {
            boolean hostForeground = RestTimerNotificationPlugin.isHostInForeground();
            boolean isLocked = isDeviceLocked(context);
            boolean screenOn = isScreenInteractive(context);
            boolean canFsi = canUseFullScreenIntentSafe(context);
            if (!hostForeground && (isLocked || !screenOn) && canFsi) {
                Intent lockIntent = new Intent(context, RestCompleteLockActivity.class);
                lockIntent.setFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_NO_USER_ACTION
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                );
                lockIntent.putExtra(EXTRA_REST_ID, restId != null ? restId : "");
                lockIntent.putExtra(EXTRA_EXERCISE_NAME, cleanExercise);
                lockIntent.putExtra(EXTRA_NEXT_SET_NUMBER, nextSetNumber);

                int fsiFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    fsiFlags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent fullScreenPi = PendingIntent.getActivity(
                    context,
                    REST_COMPLETE_NOTIFICATION_ID,
                    lockIntent,
                    fsiFlags
                );
                builder.setFullScreenIntent(fullScreenPi, true);
            }
        }

        manager.notify(REST_COMPLETE_NOTIFICATION_ID, builder.build());
    }

    public static void triggerAlarmVibration(Context context) {
        if (context == null) {
            return;
        }
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                vibrator.vibrate(
                    VibrationEffect.createWaveform(REST_COMPLETE_VIBRATION_PATTERN, -1),
                    attrs
                );
            } else {
                @SuppressWarnings("deprecation")
                long[] pattern = REST_COMPLETE_VIBRATION_PATTERN;
                vibrator.vibrate(pattern, -1);
            }
        } catch (Throwable ignored) {
        }
    }

    private static boolean isDeviceLocked(Context context) {
        try {
            KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isKeyguardLocked();
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static boolean isScreenInteractive(Context context) {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isInteractive();
        } catch (Throwable ignored) {
            return true;
        }
    }

    public static JSObject buildCapabilities(Context context) {
        JSObject res = new JSObject();
        NotificationManager manager = context != null
            ? (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)
            : null;
        if (context != null) {
            ensureChannels(context);
        }

        boolean osEnabled = context != null && NotificationManagerCompat.from(context).areNotificationsEnabled();
        boolean postGranted = isPostNotificationsGranted(context);
        boolean notificationsEnabled = osEnabled && postGranted;

        int ongoingImportance = -1;
        int ongoingLockVis = -99;
        boolean ongoingChannelEnabled = false;
        int finishImportance = -1;
        boolean finishChannelEnabled = false;

        if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ongoingCh = manager.getNotificationChannel(CHANNEL_ONGOING_ID);
            if (ongoingCh != null) {
                ongoingImportance = ongoingCh.getImportance();
                ongoingLockVis = ongoingCh.getLockscreenVisibility();
                ongoingChannelEnabled = ongoingImportance > NotificationManager.IMPORTANCE_NONE;
            }
            NotificationChannel finishCh = manager.getNotificationChannel(CHANNEL_FINISH_SOUND_ID);
            if (finishCh != null) {
                finishImportance = finishCh.getImportance();
                finishChannelEnabled = finishImportance > NotificationManager.IMPORTANCE_NONE;
            }
        } else {
            ongoingChannelEnabled = notificationsEnabled;
            finishChannelEnabled = notificationsEnabled;
        }

        boolean lockScreenSystemEnabled = true;
        if (context != null) {
            try {
                lockScreenSystemEnabled = Settings.Secure.getInt(
                    context.getContentResolver(),
                    "lock_screen_show_notifications",
                    1
                ) == 1;
            } catch (Throwable ignored) {
            }
        }

        res.put("sdkInt", Build.VERSION.SDK_INT);
        res.put("release", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "");
        res.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "");
        res.put("model", Build.MODEL != null ? Build.MODEL : "");
        res.put("notificationsEnabled", notificationsEnabled);
        res.put("osNotificationsEnabled", osEnabled);
        res.put("postNotificationsGranted", postGranted);
        res.put("ongoingChannelId", CHANNEL_ONGOING_ID);
        res.put("ongoingChannelEnabled", ongoingChannelEnabled);
        res.put("ongoingChannelImportance", ongoingImportance);
        res.put("ongoingChannelLockscreenVisibility", ongoingLockVis);
        res.put("finishChannelId", CHANNEL_FINISH_SOUND_ID);
        res.put("finishChannelEnabled", finishChannelEnabled);
        res.put("finishChannelImportance", finishImportance);
        res.put("lockScreenSystemEnabled", lockScreenSystemEnabled);
        res.put("supportsChronometerCountdown", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N);
        res.put("supportsPromotedOngoing", Build.VERSION.SDK_INT >= 36);
        res.put("canPostPromoted", canPostPromotedNotificationsSafe(manager));
        res.put("hasPromotableCharacteristics", lastNotificationPromotableCharacteristics);
        res.put("canScheduleExactAlarms", canScheduleExactAlarmsSafe(context));
        res.put("canUseFullScreenIntent", canUseFullScreenIntentSafe(context));
        res.put("ignoringBatteryOptimizations", isIgnoringBatteryOptimizationsSafe(context));
        res.put("magicOsStartupAvailable", resolveMagicOsStartupIntent(context) != null);
        return res;
    }

    public static Intent resolveMagicOsStartupIntent(Context context) {
        if (context == null) {
            return null;
        }
        PackageManager pm = context.getPackageManager();
        for (ComponentName comp : HONOR_HUAWEI_STARTUP_COMPONENTS) {
            Intent intent = new Intent();
            intent.setComponent(comp);
            ResolveInfo info = pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
            if (info != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                return intent;
            }
        }
        return null;
    }

    public static boolean openSettingsIntent(Context context, Intent primary, Intent fallback) {
        if (context == null) {
            return false;
        }
        if (primary != null) {
            try {
                primary.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(primary);
                return true;
            } catch (Throwable ignored) {
            }
        }
        if (fallback != null) {
            try {
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
                return true;
            } catch (Throwable ignored) {
            }
        }
        return false;
    }

    public static Intent buildAppDetailsIntent(Context context) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    public static String formatMmSs(int totalSeconds) {
        int safe = Math.max(0, totalSeconds);
        int mins = safe / 60;
        int secs = safe % 60;
        return String.format(Locale.US, "%02d:%02d", mins, secs);
    }

    public static String formatDurationLabel(int totalSeconds) {
        int safe = Math.max(1, totalSeconds);
        int mins = safe / 60;
        int secs = safe % 60;
        if (mins > 0 && secs > 0) {
            return mins + " min " + secs + " s";
        }
        if (mins > 0) {
            return mins + " min";
        }
        return secs + " s";
    }
}
