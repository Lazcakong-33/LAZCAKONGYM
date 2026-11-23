package com.lazcakong.gym;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Rebuilds active rest notifications and re-registers AlarmManager alarms after
 * package update, exact alarm permission grant, or device reboot.
 */
public class RestBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
            return;
        }

        RestTimerStore.StateSnapshot state = RestTimerStore.getSnapshot(context);
        if (!state.active) {
            return;
        }

        long now = System.currentTimeMillis();
        if (state.paused) {
            RestTimerNotificationHelper.showOngoingNotification(context, state, null, null, "Pausa");
            return;
        }

        if (state.targetEndTime > now) {
            RestTimerNotificationHelper.scheduleExactAlarm(
                context,
                state.targetEndTime,
                state.restId,
                state.exerciseName,
                state.nextSetNumber
            );
            RestTimerNotificationHelper.showOngoingNotification(context, state, null, null, "Descanso");
        } else if ((now - state.targetEndTime) <= 5 * 60 * 1000L) {
            RestTimerNotificationHelper.triggerRestComplete(
                context,
                state.restId,
                state.targetEndTime,
                state.exerciseName,
                state.nextSetNumber,
                state.mode,
                state.restEndAlertEnabled,
                true
            );
        } else {
            RestTimerStore.clearFromApp(context);
            RestTimerNotificationHelper.cancelOngoingNotification(context);
        }
    }
}
