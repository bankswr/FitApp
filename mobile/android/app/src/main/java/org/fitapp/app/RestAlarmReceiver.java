package org.fitapp.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/**
 * The end of a rest (RestTimerPlugin's alarm): removes the countdown notification and, unless the
 * app is on screen (its own alarm sounds then), posts a "Rest over" alert with vibration and plays
 * the chime, pausing other audio meanwhile (RestChimeService).
 */
public class RestAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        RestTimerPlugin.notifications(context).cancel(RestTimerPlugin.RUNNING_ID);
        if (MainActivity.inForeground) return;
        RestTimerPlugin.ensureChannels(context);
        try {
            ContextCompat.startForegroundService(context, new Intent(context, RestChimeService.class));
            return;
        } catch (RuntimeException e) {
            // Service start refused: alert and chime without it (other audio may keep playing).
        }
        try {
            RestTimerPlugin.notifications(context).notify(RestTimerPlugin.DONE_ID, RestTimerPlugin.restOverNotification(context));
        } catch (SecurityException e) {
            // Notifications not allowed: the chime still sounds.
        }
        PendingResult pending = goAsync();
        RestChime.play(context, pending::finish);
    }
}
