package org.fitapp.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The countdown notification's Stop button (user requirement, 2026-10-23): ends the rest without
 * opening the app. Removes the notification and the end alarm, and records which countdown was
 * stopped so the app stops its own timer too (now if it's running, else when it next looks).
 */
public class RestStopReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        RestTimerPlugin.stopFromNotification(context);
    }
}
