package org.fitapp.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

/**
 * The rest-over chime (user requirement, 2026-10-20): it takes transient audio focus, so whatever
 * else is playing (Spotify etc.) pauses, plays three short beeps on the alarm stream, then gives
 * focus back so the other app resumes. Without focus the beeps were lost under the music.
 * Android 15+ only grants focus to the top app or an app running a media foreground service,
 * which is why the alarm in the background plays it from RestChimeService.
 */
final class RestChime {
    private static final int RATE = 44100;
    /** Time for the other app to fade out and pause before the beeps. */
    private static final long PAUSE_MS = 400;
    /** Time after the beeps before handing focus back. */
    private static final long TAIL_MS = 200;

    private RestChime() {}

    /** Play the chime; done runs on the main thread once focus is given back. */
    static void play(Context context, Runnable done) {
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        AudioManager.OnAudioFocusChangeListener ignore = change -> {};
        AudioFocusRequest request = null;
        int granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(ignore)
                .build();
            granted = am.requestAudioFocus(request);
        } else {
            granted = am.requestAudioFocus(ignore, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
        // Nothing to wait for if focus wasn't granted (or nothing else was playing anyway).
        long pause = granted == AudioManager.AUDIOFOCUS_REQUEST_GRANTED && am.isMusicActive() ? PAUSE_MS : 0;

        short[] pcm = beeps();
        AudioTrack track = new AudioTrack(attrs,
            new AudioFormat.Builder()
                .setSampleRate(RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
            pcm.length * 2, AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE);
        track.write(pcm, 0, pcm.length);

        final AudioFocusRequest held = request;
        Handler main = new Handler(Looper.getMainLooper());
        main.postDelayed(() -> {
            try {
                track.play();
            } catch (IllegalStateException e) {
                // Track failed to initialise: finish without sound.
            }
        }, pause);
        main.postDelayed(() -> {
            track.release();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) am.abandonAudioFocusRequest(held);
            else am.abandonAudioFocus(ignore);
            if (done != null) done.run();
        }, pause + pcm.length * 1000L / RATE + TAIL_MS);
    }

    /** Three 880 Hz beeps, 0.18 s each with a fast decay, 0.25 s apart (same as the web app's). */
    private static short[] beeps() {
        int step = RATE / 4;
        int beep = (int) (RATE * 0.18);
        short[] pcm = new short[step * 2 + beep];
        for (int b = 0; b < 3; b++) {
            for (int i = 0; i < beep; i++) {
                double t = (double) i / RATE;
                double gain = 0.6 * Math.pow(0.001 / 0.6, t / 0.18);
                pcm[b * step + i] = (short) (Math.sin(2 * Math.PI * 880 * t) * gain * Short.MAX_VALUE);
            }
        }
        return pcm;
    }
}
