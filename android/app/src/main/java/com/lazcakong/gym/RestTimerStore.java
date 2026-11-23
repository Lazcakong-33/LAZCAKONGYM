package com.lazcakong.gym;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;

/**
 * Canonical native persistence for the active rest timer state.
 * Stores targetEndTime as the single source of truth for running timers,
 * enables pause/resume/+15s/skip from notification shade actions while WebView
 * is backgrounded, and deduplicates 0s completion alarms per restId.
 */
public final class RestTimerStore {

    private static final String PREFS_NAME = "lazcakong_rest_timer_store";
    private static final String KEY_ACTIVE = "active";
    private static final String KEY_PAUSED = "paused";
    private static final String KEY_REST_ID = "restId";
    private static final String KEY_TARGET_END_TIME = "targetEndTime";
    private static final String KEY_TOTAL_SECONDS = "totalSeconds";
    private static final String KEY_REMAINING_SECONDS = "remainingSeconds";
    private static final String KEY_EXERCISE_NAME = "exerciseName";
    private static final String KEY_NEXT_SET_NUMBER = "nextSetNumber";
    private static final String KEY_MODE = "mode";
    private static final String KEY_REST_END_ALERT_ENABLED = "restEndAlertEnabled";
    private static final String KEY_LAST_FIRED_REST_ID = "lastFiredRestId";
    private static final String KEY_LAST_FIRED_TARGET_END_TIME = "lastFiredTargetEndTime";
    private static final String KEY_PENDING_ACTION = "pendingAction";
    private static final String KEY_PENDING_ACTION_AT = "pendingActionAt";
    private static final String KEY_UPDATED_AT = "updatedAt";

    private RestTimerStore() {}

    public static final class StateSnapshot {
        public boolean active;
        public boolean paused;
        public String restId = "";
        public long targetEndTime;
        public int totalSeconds;
        public int remainingSeconds;
        public String exerciseName = "";
        public int nextSetNumber;
        public String mode = "sound";
        public boolean restEndAlertEnabled = true;
        public String lastFiredRestId = "";
        public long lastFiredTargetEndTime;
        public String pendingAction = "";
        public long pendingActionAt;
        public long updatedAt;

        public JSObject toJSObject() {
            JSObject obj = new JSObject();
            obj.put("active", active);
            obj.put("paused", paused);
            obj.put("restId", restId != null ? restId : "");
            obj.put("targetEndTime", targetEndTime);
            obj.put("totalSeconds", totalSeconds);
            obj.put("remainingSeconds", remainingSeconds);
            obj.put("exerciseName", exerciseName != null ? exerciseName : "");
            obj.put("nextSetNumber", nextSetNumber);
            obj.put("mode", mode != null ? mode : "sound");
            obj.put("restEndAlertEnabled", restEndAlertEnabled);
            obj.put("lastFiredRestId", lastFiredRestId != null ? lastFiredRestId : "");
            obj.put("lastFiredTargetEndTime", lastFiredTargetEndTime);
            obj.put("pendingAction", pendingAction != null ? pendingAction : "");
            obj.put("pendingActionAt", pendingActionAt);
            obj.put("updatedAt", updatedAt);
            return obj;
        }
    }

    private static SharedPreferences getPrefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static synchronized StateSnapshot getSnapshot(Context context) {
        StateSnapshot s = new StateSnapshot();
        if (context == null) {
            return s;
        }
        SharedPreferences p = getPrefs(context);
        s.active = p.getBoolean(KEY_ACTIVE, false);
        s.paused = p.getBoolean(KEY_PAUSED, false);
        s.restId = p.getString(KEY_REST_ID, "");
        s.targetEndTime = p.getLong(KEY_TARGET_END_TIME, 0L);
        s.totalSeconds = p.getInt(KEY_TOTAL_SECONDS, 0);
        s.remainingSeconds = p.getInt(KEY_REMAINING_SECONDS, 0);
        s.exerciseName = p.getString(KEY_EXERCISE_NAME, "");
        s.nextSetNumber = p.getInt(KEY_NEXT_SET_NUMBER, 0);
        s.mode = p.getString(KEY_MODE, "sound");
        s.restEndAlertEnabled = p.getBoolean(KEY_REST_END_ALERT_ENABLED, true);
        s.lastFiredRestId = p.getString(KEY_LAST_FIRED_REST_ID, "");
        s.lastFiredTargetEndTime = p.getLong(KEY_LAST_FIRED_TARGET_END_TIME, 0L);
        s.pendingAction = p.getString(KEY_PENDING_ACTION, "");
        s.pendingActionAt = p.getLong(KEY_PENDING_ACTION_AT, 0L);
        s.updatedAt = p.getLong(KEY_UPDATED_AT, 0L);

        if (s.active && !s.paused && s.targetEndTime > 0L) {
            long remMs = s.targetEndTime - System.currentTimeMillis();
            s.remainingSeconds = Math.max(0, (int) Math.ceil(remMs / 1000.0));
        }
        return s;
    }

    public static synchronized StateSnapshot saveRunningFromApp(
        Context context,
        String restId,
        long targetEndTime,
        int totalSeconds,
        String exerciseName,
        int nextSetNumber,
        String mode,
        boolean restEndAlertEnabled
    ) {
        long now = System.currentTimeMillis();
        int remaining = Math.max(1, (int) Math.ceil((targetEndTime - now) / 1000.0));
        int safeTotal = Math.max(totalSeconds, remaining);
        String safeMode = normalizeMode(mode);
        String safeRestId = (restId != null && !restId.trim().isEmpty())
            ? restId.trim()
            : ("rest_" + targetEndTime);

        getPrefs(context).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putBoolean(KEY_PAUSED, false)
            .putString(KEY_REST_ID, safeRestId)
            .putLong(KEY_TARGET_END_TIME, targetEndTime)
            .putInt(KEY_TOTAL_SECONDS, safeTotal)
            .putInt(KEY_REMAINING_SECONDS, remaining)
            .putString(KEY_EXERCISE_NAME, exerciseName != null ? exerciseName.trim() : "")
            .putInt(KEY_NEXT_SET_NUMBER, Math.max(0, nextSetNumber))
            .putString(KEY_MODE, safeMode)
            .putBoolean(KEY_REST_END_ALERT_ENABLED, restEndAlertEnabled)
            .putString(KEY_PENDING_ACTION, "")
            .putLong(KEY_PENDING_ACTION_AT, 0L)
            .putLong(KEY_UPDATED_AT, now)
            .apply();

        return getSnapshot(context);
    }

    public static synchronized StateSnapshot savePausedFromApp(
        Context context,
        int remainingSeconds,
        int totalSeconds,
        String exerciseName,
        int nextSetNumber,
        String mode,
        boolean restEndAlertEnabled
    ) {
        long now = System.currentTimeMillis();
        int safeRemaining = Math.max(1, remainingSeconds);
        int safeTotal = Math.max(totalSeconds, safeRemaining);

        getPrefs(context).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putBoolean(KEY_PAUSED, true)
            .putString(KEY_REST_ID, "")
            .putLong(KEY_TARGET_END_TIME, 0L)
            .putInt(KEY_TOTAL_SECONDS, safeTotal)
            .putInt(KEY_REMAINING_SECONDS, safeRemaining)
            .putString(KEY_EXERCISE_NAME, exerciseName != null ? exerciseName.trim() : "")
            .putInt(KEY_NEXT_SET_NUMBER, Math.max(0, nextSetNumber))
            .putString(KEY_MODE, normalizeMode(mode))
            .putBoolean(KEY_REST_END_ALERT_ENABLED, restEndAlertEnabled)
            .putString(KEY_PENDING_ACTION, "")
            .putLong(KEY_PENDING_ACTION_AT, 0L)
            .putLong(KEY_UPDATED_AT, now)
            .apply();

        return getSnapshot(context);
    }

    public static synchronized StateSnapshot pauseFromNativeAction(Context context) {
        StateSnapshot curr = getSnapshot(context);
        if (!curr.active || curr.paused) {
            return curr;
        }
        long now = System.currentTimeMillis();
        int remaining = curr.targetEndTime > 0L
            ? Math.max(1, (int) Math.ceil((curr.targetEndTime - now) / 1000.0))
            : Math.max(1, curr.remainingSeconds);

        getPrefs(context).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putBoolean(KEY_PAUSED, true)
            .putString(KEY_REST_ID, "")
            .putLong(KEY_TARGET_END_TIME, 0L)
            .putInt(KEY_REMAINING_SECONDS, remaining)
            .putString(KEY_PENDING_ACTION, "paused")
            .putLong(KEY_PENDING_ACTION_AT, now)
            .putLong(KEY_UPDATED_AT, now)
            .apply();

        return getSnapshot(context);
    }

    public static synchronized StateSnapshot resumeFromNativeAction(Context context) {
        StateSnapshot curr = getSnapshot(context);
        if (!curr.active || !curr.paused) {
            return curr;
        }
        long now = System.currentTimeMillis();
        int remaining = Math.max(1, curr.remainingSeconds > 0 ? curr.remainingSeconds : Math.max(60, curr.totalSeconds));
        long targetEndTime = now + (remaining * 1000L);
        String newRestId = "rest_native_" + now;

        getPrefs(context).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putBoolean(KEY_PAUSED, false)
            .putString(KEY_REST_ID, newRestId)
            .putLong(KEY_TARGET_END_TIME, targetEndTime)
            .putInt(KEY_REMAINING_SECONDS, remaining)
            .putString(KEY_PENDING_ACTION, "resumed")
            .putLong(KEY_PENDING_ACTION_AT, now)
            .putLong(KEY_UPDATED_AT, now)
            .apply();

        return getSnapshot(context);
    }

    public static synchronized StateSnapshot adjustFromNativeAction(Context context, int deltaSeconds) {
        StateSnapshot curr = getSnapshot(context);
        if (!curr.active) {
            return curr;
        }
        long now = System.currentTimeMillis();
        int baseRemaining = curr.paused || curr.targetEndTime <= 0L
            ? curr.remainingSeconds
            : Math.max(0, (int) Math.ceil((curr.targetEndTime - now) / 1000.0));
        int nextRemaining = Math.max(0, baseRemaining + deltaSeconds);

        if (nextRemaining <= 0) {
            return clearFromNativeAction(context, "skipped");
        }

        int nextTotal = Math.max(curr.totalSeconds, nextRemaining);
        if (curr.paused) {
            getPrefs(context).edit()
                .putBoolean(KEY_ACTIVE, true)
                .putBoolean(KEY_PAUSED, true)
                .putInt(KEY_REMAINING_SECONDS, nextRemaining)
                .putInt(KEY_TOTAL_SECONDS, nextTotal)
                .putString(KEY_PENDING_ACTION, "adjusted")
                .putLong(KEY_PENDING_ACTION_AT, now)
                .putLong(KEY_UPDATED_AT, now)
                .apply();
        } else {
            long newTarget = now + (nextRemaining * 1000L);
            String newRestId = "rest_native_" + now;
            getPrefs(context).edit()
                .putBoolean(KEY_ACTIVE, true)
                .putBoolean(KEY_PAUSED, false)
                .putString(KEY_REST_ID, newRestId)
                .putLong(KEY_TARGET_END_TIME, newTarget)
                .putInt(KEY_REMAINING_SECONDS, nextRemaining)
                .putInt(KEY_TOTAL_SECONDS, nextTotal)
                .putString(KEY_PENDING_ACTION, "adjusted")
                .putLong(KEY_PENDING_ACTION_AT, now)
                .putLong(KEY_UPDATED_AT, now)
                .apply();
        }

        return getSnapshot(context);
    }

    public static synchronized StateSnapshot clearFromNativeAction(Context context, String actionName) {
        long now = System.currentTimeMillis();
        getPrefs(context).edit()
            .putBoolean(KEY_ACTIVE, false)
            .putBoolean(KEY_PAUSED, false)
            .putString(KEY_REST_ID, "")
            .putLong(KEY_TARGET_END_TIME, 0L)
            .putInt(KEY_REMAINING_SECONDS, 0)
            .putString(KEY_PENDING_ACTION, actionName != null ? actionName : "skipped")
            .putLong(KEY_PENDING_ACTION_AT, now)
            .putLong(KEY_UPDATED_AT, now)
            .apply();
        return getSnapshot(context);
    }

    public static synchronized void clearFromApp(Context context) {
        long now = System.currentTimeMillis();
        getPrefs(context).edit()
            .putBoolean(KEY_ACTIVE, false)
            .putBoolean(KEY_PAUSED, false)
            .putString(KEY_REST_ID, "")
            .putLong(KEY_TARGET_END_TIME, 0L)
            .putInt(KEY_REMAINING_SECONDS, 0)
            .putString(KEY_PENDING_ACTION, "")
            .putLong(KEY_PENDING_ACTION_AT, 0L)
            .putLong(KEY_UPDATED_AT, now)
            .apply();
    }

    public static synchronized boolean tryClaimCompletion(
        Context context,
        String restId,
        long targetEndTime,
        boolean fromNativeAlarm
    ) {
        if (context == null) {
            return false;
        }
        StateSnapshot curr = getSnapshot(context);
        String safeRestId = restId != null ? restId.trim() : "";

        if (!safeRestId.isEmpty() && safeRestId.equals(curr.lastFiredRestId)) {
            return false;
        }
        if (targetEndTime > 0L && targetEndTime == curr.lastFiredTargetEndTime) {
            return false;
        }

        long now = System.currentTimeMillis();
        SharedPreferences.Editor ed = getPrefs(context).edit()
            .putBoolean(KEY_ACTIVE, false)
            .putBoolean(KEY_PAUSED, false)
            .putString(KEY_REST_ID, "")
            .putLong(KEY_TARGET_END_TIME, 0L)
            .putInt(KEY_REMAINING_SECONDS, 0)
            .putLong(KEY_UPDATED_AT, now);

        if (!safeRestId.isEmpty()) {
            ed.putString(KEY_LAST_FIRED_REST_ID, safeRestId);
        }
        if (targetEndTime > 0L) {
            ed.putLong(KEY_LAST_FIRED_TARGET_END_TIME, targetEndTime);
        }
        if (fromNativeAlarm) {
            ed.putString(KEY_PENDING_ACTION, "completed");
            ed.putLong(KEY_PENDING_ACTION_AT, now);
        } else {
            ed.putString(KEY_PENDING_ACTION, "");
            ed.putLong(KEY_PENDING_ACTION_AT, 0L);
        }
        ed.apply();
        return true;
    }

    public static synchronized void consumePendingAction(Context context) {
        if (context == null) {
            return;
        }
        getPrefs(context).edit()
            .putString(KEY_PENDING_ACTION, "")
            .putLong(KEY_PENDING_ACTION_AT, 0L)
            .apply();
    }

    private static String normalizeMode(String mode) {
        if ("vibrate_only".equals(mode) || "silent".equals(mode)) {
            return mode;
        }
        return "sound";
    }
}
