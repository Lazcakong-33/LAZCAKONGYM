package com.lazcakong.gym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Triggered by Android AlarmManager when the rest countdown targetEndTime completes.
 * Dismisses the ongoing chronometer, prevents duplicate alerts per restId, and delivers
 * the completion notification / lock-screen visual alert even in Doze/locked mode.
 */
public class RestAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        String intentRestId = intent.getStringExtra(RestTimerNotificationHelper.EXTRA_REST_ID);
        long intentTarget = intent.getLongExtra(RestTimerNotificationHelper.EXTRA_TARGET_END_TIME, 0L);

        RestTimerStore.StateSnapshot state = RestTimerStore.getSnapshot(context);
        if (!state.active || state.paused) {
            return;
        }

        // Ignore stale alarms superseded by +15s adjustments or restarted timers
        if (intentRestId != null && !intentRestId.isEmpty() && state.restId != null && !state.restId.isEmpty()) {
            if (!intentRestId.equals(state.restId)) {
                return;
            }
        } else if (intentTarget > 0L && state.targetEndTime > 0L && Math.abs(intentTarget - state.targetEndTime) > 1500L) {
            return;
        }

        RestTimerNotificationHelper.triggerRestComplete(
            context,
            state.restId != null && !state.restId.isEmpty() ? state.restId : intentRestId,
            state.targetEndTime > 0L ? state.targetEndTime : intentTarget,
            state.exerciseName,
            state.nextSetNumber,
            state.mode,
            state.restEndAlertEnabled,
            true
        );

        RestTimerNotificationPlugin.notifyStateChangedFromNative(context);
    }
}
