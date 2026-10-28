package is.gombiman.rjupnakort;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.StatusBarNotification;

/** Litar Másson-tilkynninguna (GPS í bakgrunni) eftir því hvar þú ert. */
final class ZoneNotif {
    // Sama auðkenni og rás og í @capacitor-community/background-geolocation
    static final int ID = 28351;
    static final String CHANNEL = "com.equimaps.capacitor_background_geolocation";

    private ZoneNotif() {}

    static String lastKind = "q", lastTitle = "", lastText = "";
    static boolean paused = false;

    static PendingIntent action(Context ctx, String a, int req) {
        Intent i = new Intent(ctx, HuntActionReceiver.class).setAction(HuntActionReceiver.ACTION).putExtra("a", a);
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Endurbirtir tilkynninguna með síðustu stöðu (t.d. eftir pásu). */
    static void refresh(Context ctx) { update(ctx, lastKind, lastTitle, lastText); }

    static void update(Context ctx, String kind, String title, String text) {
        lastKind = kind; lastTitle = title; lastText = text;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        boolean shown = false;
        try {
            for (StatusBarNotification s : nm.getActiveNotifications()) if (s.getId() == ID) { shown = true; break; }
        } catch (Exception e) { return; }
        if (!shown) return;   // ferðin er ekki í gangi: ekki búa til nýja tilkynningu

        int icon, color;
        if ("ok".equals(kind)) { icon = R.drawable.ic_stat_rjupa_ok; color = 0xFF2F9E4F; }
        else if ("bann".equals(kind)) { icon = R.drawable.ic_stat_rjupa_bann; color = 0xFFD62F25; }
        else { icon = R.drawable.ic_stat_rjupa_q; color = 0xFFE39400; }

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        if (paused) { color = 0xFF6B6A63; title = "⏸ Í pásu · slóðin skráist ekki"; }
        b.setSmallIcon(icon).setColor(color).setColorized(true)
            .setContentTitle(title).setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .setCategory(Notification.CATEGORY_NAVIGATION);
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            b.setContentIntent(PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        android.graphics.drawable.Icon ai = android.graphics.drawable.Icon.createWithResource(ctx, R.drawable.ic_stat_rjupa);
        b.addAction(new Notification.Action.Builder(ai, paused ? "▶ Halda áfram" : "⏸ Pása", action(ctx, paused ? "resume" : "pause", 1)).build());
        b.addAction(new Notification.Action.Builder(ai, "⏹ Ljúka ferð", action(ctx, "stop", 2)).build());
        try { nm.notify(ID, b.build()); } catch (Exception ignored) {}
    }
}
