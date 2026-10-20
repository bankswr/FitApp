package org.fitapp.app;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import androidx.core.app.ServiceCompat;

/**
 * Plays the rest-over chime while the app is in the background. Android 15+ only grants audio
 * focus (needed to pause other audio) to a media foreground service then, so this runs as one for
 * the second or so of the chime, with the "Rest over" alert as its notification. The alert stays
 * after the service stops. Started by RestAlarmReceiver, which an alarm clock allows to do so.
 */
public class RestChimeService extends Service {
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ServiceCompat.startForeground(this, RestTimerPlugin.DONE_ID, RestTimerPlugin.restOverNotification(this),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        RestChime.play(this, () -> {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
            // Re-post it without alerting again, dropping the service's "can't swipe away" flag.
            try {
                RestTimerPlugin.notifications(this).notify(RestTimerPlugin.DONE_ID,
                    RestTimerPlugin.restOverBuilder(this).setOnlyAlertOnce(true).build());
            } catch (SecurityException e) {
                // Notifications not allowed: nothing was shown anyway.
            }
            stopSelf(startId);
        });
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
