package org.fitapp.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Rest timer on the phone itself (user requirement, 2026-10-13): while a countdown runs, an ongoing
 * notification shows it counting down (status bar and lock screen), and an alarm-clock alarm fires
 * at the end even if the phone is asleep (RestAlarmReceiver). The web code calls start() whenever
 * the end time is set or changed and stop() when the countdown stops or ends in the app.
 * The notification's Stop button ends it from the tray (RestStopReceiver); the app hears of that
 * through the "stopped" event, or takeStopped() when it comes back.
 */
@CapacitorPlugin(name = "RestTimer")
public class RestTimerPlugin extends Plugin {
    static final String CHANNEL_RUNNING = "rest_timer";
    // Silent: RestChime plays the sound (2026-10-20). "rest_over" was the old channel with a sound.
    static final String CHANNEL_DONE = "rest_alert";
    private static final String CHANNEL_DONE_OLD = "rest_over";
    static final int RUNNING_ID = 101;
    static final int DONE_ID = 102;
    private static final String PREFS = "rest_timer";
    private static final String ENDS_AT = "ends_at"; // the countdown the notification shows
    private static final String STOPPED = "stopped_ends_at"; // a countdown stopped from the tray, not yet seen by the app
    private static volatile RestTimerPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

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
        prefs(context).edit().putLong(ENDS_AT, end).remove(STOPPED).apply();
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

    /** The rest-over chime while the app is on screen (pauses other audio meanwhile). */
    @PluginMethod
    public void chime(PluginCall call) {
        RestChime.play(getContext(), null);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        cancelAll(getContext());
        prefs(getContext()).edit().remove(ENDS_AT).apply();
        call.resolve();
    }

    /** The end time of a countdown stopped from the notification since the last call ({ endsAt: null } if none). */
    @PluginMethod
    public void takeStopped(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        JSObject result = new JSObject();
        result.put("endsAt", p.contains(STOPPED) ? p.getLong(STOPPED, 0) : null);
        p.edit().remove(STOPPED).apply();
        call.resolve(result);
    }

    /** The notification's Stop button (RestStopReceiver). */
    static void stopFromNotification(Context context) {
        cancelAll(context);
        SharedPreferences p = prefs(context);
        if (p.contains(ENDS_AT)) p.edit().putLong(STOPPED, p.getLong(ENDS_AT, 0)).remove(ENDS_AT).apply();
        RestTimerPlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners("stopped", new JSObject());
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
        done.setDescription("Alert and vibration when a rest ends (the app plays the chime)");
        done.setSound(null, null);
        done.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        done.enableVibration(true);
        done.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 400 });
        notifications(context).createNotificationChannel(running);
        notifications(context).createNotificationChannel(done);
        notifications(context).deleteNotificationChannel(CHANNEL_DONE_OLD);
    }

    /** The "Rest over" alert: vibration only, the chime is RestChime's. */
    static Notification restOverNotification(Context context) {
        return restOverBuilder(context).build();
    }

    static NotificationCompat.Builder restOverBuilder(Context context) {
        return new NotificationCompat.Builder(context, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle("Rest over")
            .setContentText("Time for your next set.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSound(null)
            .setVibrate(new long[] { 0, 400, 200, 400, 200, 400 })
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openApp(context));
    }

    private static Notification runningNotification(Context context, long end) {
        // "Rest Timer" over a large countdown (user requirement, 2026-10-18). The standard layouts
        // only show a chronometer small in the header, so the body is a custom view (collapsed: one
        // row, as the height is capped; expanded: stacked, bigger).
        long base = SystemClock.elapsedRealtime() + (end - System.currentTimeMillis());
        RemoteViews body = countdownView(context, R.layout.notification_rest_timer, base);
        RemoteViews big = countdownView(context, R.layout.notification_rest_timer_big, base);
        return new NotificationCompat.Builder(context, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle("Rest Timer")
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(body)
            .setCustomBigContentView(big)
            .setShowWhen(false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp(context))
            .addAction(R.drawable.ic_stat_timer, "Stop", stopIntent(context))
            .build();
    }

    private static PendingIntent stopIntent(Context context) {
        Intent intent = new Intent(context, RestStopReceiver.class);
        return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews countdownView(Context context, int layout, long base) {
        RemoteViews view = new RemoteViews(context.getPackageName(), layout);
        view.setChronometer(R.id.rest_countdown, base, null, true);
        view.setChronometerCountDown(R.id.rest_countdown, true);
        return view;
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
