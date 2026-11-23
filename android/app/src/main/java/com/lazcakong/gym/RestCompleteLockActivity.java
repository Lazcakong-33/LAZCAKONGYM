package com.lazcakong.gym;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Dedicated lockscreen rest-completion visual alert activity.
 * Launched strictly via NotificationCompat.Builder.setFullScreenIntent(...) when
 * canUseFullScreenIntent() is permitted and the device is locked / screen off.
 * Automatically releases wake flags after 45 seconds so the battery is protected.
 */
public class RestCompleteLockActivity extends AppCompatActivity {

    private final Handler autoCloseHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoCloseRunnable = () -> {
        if (!isFinishing()) {
            finish();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            @SuppressWarnings("deprecation")
            int legacyFlags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            getWindow().addFlags(legacyFlags);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_rest_complete_lock);

        String restId = getIntent() != null ? getIntent().getStringExtra(RestTimerNotificationHelper.EXTRA_REST_ID) : "";
        String exerciseName = getIntent() != null ? getIntent().getStringExtra(RestTimerNotificationHelper.EXTRA_EXERCISE_NAME) : "";
        int nextSetNumber = getIntent() != null ? getIntent().getIntExtra(RestTimerNotificationHelper.EXTRA_NEXT_SET_NUMBER, 0) : 0;

        TextView subtitleView = findViewById(R.id.lock_subtitle);
        if (subtitleView != null) {
            if (exerciseName != null && !exerciseName.trim().isEmpty() && nextSetNumber > 0) {
                subtitleView.setText("Siguiente serie: " + exerciseName.trim() + " · Serie " + nextSetNumber);
            } else if (exerciseName != null && !exerciseName.trim().isEmpty()) {
                subtitleView.setText("Siguiente ejercicio: " + exerciseName.trim());
            } else {
                subtitleView.setText("Descanso finalizado. Continúa tu entrenamiento.");
            }
        }

        Button continueBtn = findViewById(R.id.btn_continue_workout);
        if (continueBtn != null) {
            continueBtn.setOnClickListener(v -> {
                RestTimerNotificationHelper.cancelCompleteNotification(this);
                Intent openIntent = new Intent(this, MainActivity.class);
                openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                openIntent.putExtra(RestTimerNotificationHelper.EXTRA_OPEN_ACTIVE_WORKOUT, true);
                openIntent.putExtra(RestTimerNotificationHelper.EXTRA_REST_ID, restId != null ? restId : "");
                startActivity(openIntent);
                finish();
            });
        }

        Button dismissBtn = findViewById(R.id.btn_dismiss_alert);
        if (dismissBtn != null) {
            dismissBtn.setOnClickListener(v -> {
                RestTimerNotificationHelper.cancelCompleteNotification(this);
                finish();
            });
        }

        autoCloseHandler.postDelayed(autoCloseRunnable, 45_000L);
    }

    @Override
    protected void onDestroy() {
        autoCloseHandler.removeCallbacks(autoCloseRunnable);
        super.onDestroy();
    }
}
