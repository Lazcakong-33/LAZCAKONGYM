package com.lazcakong.gym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.Locale;

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

        if (RestTimerNotificationHelper.ACTION_REST_WARNING.equals(intent.getAction())) {
            if (!RestTimerNotificationPlugin.isHostInForeground()
                && "sound".equals(state.mode) && state.targetEndTime == intentTarget
                && state.targetEndTime - System.currentTimeMillis() >= 3500L) {
                speakWarning(context.getApplicationContext(), state);
            }
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

    private void speakWarning(Context context, RestTimerStore.StateSnapshot scheduled) {
        PendingResult result = goAsync();
        Handler main = new Handler(Looper.getMainLooper());
        TextToSpeech[] engine = new TextToSpeech[1];
        Runnable finish = new Runnable() {
            private boolean finished;

            @Override public void run() {
                if (finished) return;
                finished = true;
                if (engine[0] != null) {
                    engine[0].shutdown();
                    engine[0] = null;
                }
                result.finish();
            }
        };
        engine[0] = new TextToSpeech(context, status -> main.post(() -> {
            TextToSpeech voice = engine[0];
            if (voice == null) return;
            RestTimerStore.StateSnapshot current = RestTimerStore.getSnapshot(context);
            if (status != TextToSpeech.SUCCESS || !current.active || current.paused
                || !"sound".equals(current.mode) || current.targetEndTime != scheduled.targetEndTime
                || current.targetEndTime - System.currentTimeMillis() < 2600L
                || RestTimerNotificationPlugin.isHostInForeground()
                || (voice.setLanguage(Locale.forLanguageTag("es-CL")) < 0
                    && voice.setLanguage(new Locale("es")) < 0)) {
                finish.run();
                return;
            }
            voice.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            voice.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { main.post(finish); }
                @Override public void onError(String id) { main.post(finish); }
            });
            if (voice.speak("Te quedan cinco segundos de descanso.", TextToSpeech.QUEUE_FLUSH,
                null, "rest-warning") == TextToSpeech.ERROR) finish.run();
        }));
        main.postDelayed(finish, Math.max(1L, scheduled.targetEndTime - System.currentTimeMillis() - 200L));
    }
}
