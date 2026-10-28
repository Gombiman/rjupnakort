package is.gombiman.rjupnakort;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Heldur hlustun á hóprásinni gangandi til miðnættis á keppnisdögum, líka með appið lokað,
 * svo kvöldkosning, einvígi, mont og spil berist sem tilkynningar.
 */
public class HopurService extends Service {
    static final String CH = "hopur_bg";
    private final Handler h = new Handler(Looper.getMainLooper());

    static void start(Context c, long until) {
        Context ctx = c.getApplicationContext();
        Felagar.prefs(ctx).edit().putLong("listenUntil", until).apply();
        try {
            if (until > System.currentTimeMillis()) ContextCompat.startForegroundService(ctx, new Intent(ctx, HopurService.class));
            else ctx.stopService(new Intent(ctx, HopurService.class));
        } catch (Exception e) { Log.i(Felagar.TAG, "hópþjónusta: " + e); }
        NtfyListener.apply(ctx);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        long until = Felagar.prefs(this).getLong("listenUntil", 0);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            NotificationChannel ch = new NotificationChannel(CH, "Hópurinn í bakgrunni", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Lítil tilkynning á meðan appið hlustar á hópinn til miðnættis");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 77, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat_rjupa).setColor(0xFFE8590C)
            .setContentTitle("S. Másson")
            .setContentText("Hlustar á hópinn til miðnættis")
            .setOngoing(true).setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(pi).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(77, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            else startForeground(77, n);
        } catch (Exception e) {
            Log.i(Felagar.TAG, "startForeground: " + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (until <= System.currentTimeMillis()) { stopSelf(); return START_NOT_STICKY; }
        NtfyListener.apply(this);
        h.removeCallbacksAndMessages(null);
        h.postDelayed(this::stopSelf, Math.max(1000, until - System.currentTimeMillis()));
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        h.removeCallbacksAndMessages(null);
        NtfyListener.apply(this);
        super.onDestroy();
    }
}
