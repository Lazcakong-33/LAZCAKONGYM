package com.lazcakong.gym;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RestTimerNotificationPlugin.class);
        registerPlugin(CoachSpeechPlugin.class);
        super.onCreate(savedInstanceState);
        RestTimerNotificationPlugin.handleLaunchIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        RestTimerNotificationPlugin.handleLaunchIntent(intent);
    }
}
