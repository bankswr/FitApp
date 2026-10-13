package org.fitapp.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Whether the app is on screen (RestAlarmReceiver leaves the alert to the app then). */
    static volatile boolean inForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RestTimerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
    }

    @Override
    public void onPause() {
        inForeground = false;
        super.onPause();
    }
}
