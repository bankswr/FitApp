package org.fitapp.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Rest timer on the phone itself (user requirement, 2026-10-13): while a countdown runs, an ongoing
 * notification shows it counting down (status bar and lock screen), and an alarm-clock alarm fires
 * at the end even if the phone is asleep (RestAlarmReceiver). The web code calls start() whenever
 * the end time is set or changed and stop() when the countdown stops or ends in the app.
 */
@CapacitorPlugin(name = "RestTimer")
public class RestTimerPlugin extends Plugin {
    static final String CHANNEL_RUNNING = "rest_timer";
    static final String CHANNEL_DONE = "rest_over";
    static final int RUNNING_ID = 101;
    static final int DONE_ID = 102;

    @PluginMethod
    public void start(PluginCall call) {
        // optDouble: getDouble() returns null for a whole number, which Date.now() always is.
        double endsAt = call.getData().optDouble("endsAt", Double.NaN);
        if (Double.isNaN(endsAt)) {
            call.reject("endsAt is required");
            return;
        }
        Context context = getContext();
        long end = (long) endsAt;
        cancelAll(context);
        ensureChannels(context);
        try {
            notifications(context).notify(RUNNING_ID, runningNotification(context, end));
        } catch (SecurityException e) {
            // No notification permission: the alarm below still ends the rest.
        }
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent fire = alarmIntent(context);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
            // An alarm clock is exempt from Doze, so it fires on time with the screen off.
            alarms.setAlarmClock(new AlarmManager.AlarmClockInfo(end, openApp(context)), fire);
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, fire);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        cancelAll(getContext());
        call.resolve();
    }

    private static void cancelAll(Context context) {
        ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).cancel(alarmIntent(context));
        notifications(context).cancel(RUNNING_ID);
        notifications(context).cancel(DONE_ID);
    }

    static NotificationManager notifications(Context context) {
        return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel running = new NotificationChannel(CHANNEL_RUNNING, "Rest timer", NotificationManager.IMPORTANCE_LOW);
        running.setDescription("The countdown while you rest");
        running.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        running.setShowBadge(false);
        NotificationChannel done = new NotificationChannel(CHANNEL_DONE, "Rest over", NotificationManager.IMPORTANCE_HIGH);
        done.setDescription("Sound and vibration when a rest ends");
        done.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        done.enableVibration(true);
        done.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 400 });
        notifications(context).createNotificationChannel(running);
        notifications(context).createNotificationChannel(done);
    }

    private static Notification runningNotification(Context context, long end) {
        return new NotificationCompat.Builder(context, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle("Resting")
            .setContentText("Next set when the countdown ends")
            .setWhen(end)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp(context))
            .build();
    }

    static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, RestAlarmReceiver.class);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
