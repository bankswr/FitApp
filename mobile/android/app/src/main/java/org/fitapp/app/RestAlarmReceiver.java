package org.fitapp.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationCompat;

/**
 * The end of a rest (RestTimerPlugin's alarm): removes the countdown notification and, unless the
 * app is on screen (its own alarm sounds then), posts a "Rest over" alert with sound and vibration.
 */
public class RestAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        RestTimerPlugin.notifications(context).cancel(RestTimerPlugin.RUNNING_ID);
        if (MainActivity.inForeground) return;
        RestTimerPlugin.ensureChannels(context);
        try {
            RestTimerPlugin.notifications(context).notify(RestTimerPlugin.DONE_ID,
                new NotificationCompat.Builder(context, RestTimerPlugin.CHANNEL_DONE)
                    .setSmallIcon(R.drawable.ic_stat_timer)
                    .setContentTitle("Rest over")
                    .setContentText("Time for your next set.")
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setDefaults(NotificationCompat.DEFAULT_SOUND)
                    .setVibrate(new long[] { 0, 400, 200, 400, 200, 400 })
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setAutoCancel(true)
                    .setContentIntent(RestTimerPlugin.openApp(context))
                    .build());
        } catch (SecurityException e) {
            // Notifications not allowed: nothing to show.
        }
    }
}
