package com.lazcakong.gym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles interactive notification shade & lockscreen actions (Pause, Resume, +15s, Skip, Dismiss)
 * purely natively without requiring WebView/JavaScript polling in background.
 */
public class RestTimerActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        String action = intent.getAction();
        if (action == null) {
            return;
        }

        if (RestTimerNotificationHelper.ACTION_PAUSE.equals(action)) {
            RestTimerStore.StateSnapshot state = RestTimerStore.pauseFromNativeAction(context);
            RestTimerNotificationHelper.cancelExactAlarm(context);
            if (state.active) {
                RestTimerNotificationHelper.showOngoingNotification(context, state, null, null, "Pausa");
            }
            RestTimerNotificationPlugin.notifyStateChangedFromNative(context);
            return;
        }

        if (RestTimerNotificationHelper.ACTION_RESUME.equals(action)) {
            RestTimerStore.StateSnapshot state = RestTimerStore.resumeFromNativeAction(context);
            if (state.active && !state.paused && state.targetEndTime > System.currentTimeMillis()) {
                RestTimerNotificationHelper.scheduleExactAlarm(
                    context,
                    state.targetEndTime,
                    state.restId,
                    state.exerciseName,
                    state.nextSetNumber
                );
                RestTimerNotificationHelper.showOngoingNotification(context, state, null, null, "Descanso");
            }
            RestTimerNotificationPlugin.notifyStateChangedFromNative(context);
            return;
        }

        if (RestTimerNotificationHelper.ACTION_ADD_15S.equals(action)) {
            RestTimerStore.StateSnapshot state = RestTimerStore.adjustFromNativeAction(context, 15);
            if (!state.active) {
                RestTimerNotificationHelper.cancelExactAlarm(context);
                RestTimerNotificationHelper.cancelOngoingNotification(context);
            } else if (state.paused) {
                RestTimerNotificationHelper.cancelExactAlarm(context);
                RestTimerNotificationHelper.showOngoingNotification(context, state, null, null, "Pausa");
            } else if (state.targetEndTime > System.currentTimeMillis()) {
                RestTimerNotificationHelper.scheduleExactAlarm(
                    context,
                    state.targetEndTime,
                    state.restId,
                    state.exerciseName,
                    state.nextSetNumber
                );
                RestTimerNotificationHelper.showOngoingNotification(context, state, null, null, "Descanso");
            }
            RestTimerNotificationPlugin.notifyStateChangedFromNative(context);
            return;
        }

        if (RestTimerNotificationHelper.ACTION_SKIP.equals(action)) {
            RestTimerStore.clearFromNativeAction(context, "skipped");
            RestTimerNotificationHelper.cancelExactAlarm(context);
            RestTimerNotificationHelper.cancelOngoingNotification(context);
            RestTimerNotificationHelper.cancelCompleteNotification(context);
            RestTimerNotificationPlugin.notifyStateChangedFromNative(context);
            return;
        }

        if (RestTimerNotificationHelper.ACTION_DISMISS_COMPLETE.equals(action)) {
            RestTimerNotificationHelper.cancelCompleteNotification(context);
        }
    }
}
