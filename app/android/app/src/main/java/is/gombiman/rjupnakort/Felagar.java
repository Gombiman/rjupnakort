package is.gombiman.rjupnakort;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.SmsManager;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Finna félaga: beiðni um staðsetningu og svar, um ntfy.sh (dulkóðað með hópkóða) og SMS.
 * Allt hér virkar líka þegar appið er lokað (SMS) eða í bakgrunni (ntfy í veiðiham).
 */
public final class Felagar {
    static final String TAG = "Felagar";
    static final String PREFS = "felagar";
    static final String CH = "felagar";
    static final String NTFY = "https://ntfy.sh/";
    static final long SMS_FALLBACK_MS = 25000;
    static final ExecutorService IO = Executors.newCachedThreadPool();
    static final Handler MAIN = new Handler(Looper.getMainLooper());
    static final Map<String, Long> waiting = new HashMap<>();   // símanúmer (7 síðustu) -> tími beiðni
    static final Map<String, Long> lastAnswered = new HashMap<>();
    static final Pattern LOC = Pattern.compile("\\[(-?\\d+\\.\\d+),(-?\\d+\\.\\d+),(\\d+),(\\d+)\\]");
    private static byte[] keyCache; private static String keyFor;

    private Felagar() {}

    /* ---------- Stillingar ---------- */
    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static String myPhone(Context c) { return prefs(c).getString("myPhone", ""); }
    static String myName(Context c) { return prefs(c).getString("myName", ""); }
    static String group(Context c) { return prefs(c).getString("group", "").trim(); }
    static boolean autoReply(Context c) { return prefs(c).getBoolean("autoReply", true); }
    static boolean hunt(Context c) { return prefs(c).getBoolean("hunt", false); }

    static String last7(String phone) {
        if (phone == null) return "";
        String d = phone.replaceAll("[^0-9]", "");
        return d.length() <= 7 ? d : d.substring(d.length() - 7);
    }
    static String dialable(String phone) {
        String d = phone.replaceAll("[^0-9+]", "");
        if (d.replace("+", "").length() == 7) return "+354" + d;
        return d;
    }
    /** Skilar {name, phone} félaga eða null ef númerið er ekki á listanum. */
    static JSONObject friend(Context c, String anyPhone) {
        String k = last7(anyPhone);
        if (k.length() < 7) return null;
        try {
            JSONArray a = new JSONArray(prefs(c).getString("friends", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject f = a.getJSONObject(i);
                if (k.equals(last7(f.optString("phone")))) return f;
            }
        } catch (Exception e) { Log.w(TAG, "friends", e); }
        return null;
    }
    static String friendName(Context c, String phone) {
        JSONObject f = friend(c, phone);
        return f != null && f.optString("name").length() > 0 ? f.optString("name") : phone;
    }

    /* ---------- Dulkóðun ---------- */
    static synchronized byte[] key(String group) throws Exception {
        if (keyCache != null && group.equals(keyFor)) return keyCache;
        PBEKeySpec spec = new PBEKeySpec(group.toCharArray(), "rjupnakort-v1".getBytes(StandardCharsets.UTF_8), 20000, 256);
        keyCache = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded();
        keyFor = group;
        return keyCache;
    }
    static String encrypt(String group, String plain) throws Exception {
        byte[] iv = new byte[12]; new SecureRandom().nextBytes(iv);
        Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
        ci.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key(group), "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = ci.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, out, 0, iv.length); System.arraycopy(ct, 0, out, iv.length, ct.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }
    static String decrypt(String group, String b64) throws Exception {
        byte[] all = Base64.decode(b64, Base64.NO_WRAP);
        Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
        ci.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key(group), "AES"), new GCMParameterSpec(128, all, 0, 12));
        return new String(ci.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    }
    static String topic(String group, String phone) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(("topic|" + group + "|" + last7(phone)).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder("rk_");
            for (int i = 0; i < 12; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) { return "rk_invalid"; }
    }

    /* ---------- Biðja félaga um staðsetningu ---------- */
    /** Skilar "ntfy" eða "sms" eftir því hvaða leið var reynd fyrst. */
    static String requestFriend(Context c, String phone) {
        final Context ctx = c.getApplicationContext();
        final String k = last7(phone);
        final long now = System.currentTimeMillis();
        waiting.put(k, now);
        String g = group(ctx);
        if (g.length() >= 4 && myPhone(ctx).length() > 0) {
            NtfyListener.ensure(ctx, 3 * 60 * 1000);
            IO.execute(() -> {
                boolean ok = false;
                try {
                    JSONObject m = new JSONObject();
                    m.put("t", "req"); m.put("from", last7(myPhone(ctx))); m.put("name", myName(ctx)); m.put("ts", now / 1000);
                    ok = publish(topic(g, phone), encrypt(g, m.toString()));
                } catch (Exception e) { Log.w(TAG, "ntfy req", e); }
                if (!ok) { sendRequestSms(ctx, phone); emitStatus(k, "sms"); }
            });
            MAIN.postDelayed(() -> {
                Long t = waiting.get(k);
                if (t != null && t == now) { sendRequestSms(ctx, phone); emitStatus(k, "sms"); }
            }, SMS_FALLBACK_MS);
            return "ntfy";
        }
        sendRequestSms(ctx, phone);
        return "sms";
    }
    static void sendRequestSms(Context c, String phone) {
        String n = myName(c).length() > 0 ? myName(c) : "Félagi";
        sendSms(c, phone, "RJUPA? " + n + " er að leita að þér (S. Másson).");
    }

    /* ---------- Svara beiðni ---------- */
    static void handleRequest(Context c, String fromPhone, String via) {
        final Context ctx = c.getApplicationContext();
        JSONObject f = friend(ctx, fromPhone);
        if (f == null) { Log.i(TAG, "Beiðni frá óþekktu númeri hunsuð"); return; }
        final String name = f.optString("name", fromPhone);
        if (!autoReply(ctx)) {
            notify(ctx, 300 + Math.abs(last7(fromPhone).hashCode() % 100), name + " er að leita að þér",
                   "Sjálfvirk svör eru óvirk. Opnaðu S. Másson til að svara.");
            return;
        }
        String k = last7(fromPhone);
        Long last = lastAnswered.get(k);
        if (last != null && System.currentTimeMillis() - last < 20000) return;
        lastAnswered.put(k, System.currentTimeMillis());
        final String phone = f.optString("phone", fromPhone);
        currentLocation(ctx, loc -> {
            if (loc == null) {
                if ("sms".equals(via)) sendSms(ctx, phone, "RJUPA! " + myName(ctx) + ": næ ekki GPS-staðsetningu í augnablikinu.");
                notify(ctx, 400, name + " bað um staðsetningu", "Náði ekki GPS-staðsetningu til að svara.");
                return;
            }
            boolean sent = false;
            String g = group(ctx);
            if ("ntfy".equals(via) && g.length() >= 4) {
                final Location L = loc;
                IO.execute(() -> {
                    boolean ok = false;
                    try {
                        JSONObject m = new JSONObject();
                        m.put("t", "loc"); m.put("from", last7(myPhone(ctx))); m.put("name", myName(ctx));
                        m.put("lat", L.getLatitude()); m.put("lon", L.getLongitude());
                        m.put("acc", Math.round(L.getAccuracy())); m.put("ts", L.getTime() / 1000);
                        ok = publish(topic(g, phone), encrypt(g, m.toString()));
                    } catch (Exception e) { Log.w(TAG, "ntfy loc", e); }
                    if (!ok) sendLocationSms(ctx, phone, L);
                });
                sent = true;
            }
            if (!sent) sendLocationSms(ctx, phone, loc);
            notify(ctx, 500 + Math.abs(k.hashCode() % 100), name + " fékk staðsetninguna þína",
                   "Sjálfvirkt svar kl " + hhmm(System.currentTimeMillis()) + ("ntfy".equals(via) ? " (net)" : " (SMS)"));
        });
    }
    static void sendLocationSms(Context c, String phone, Location l) {
        String body = String.format(Locale.US, "RJUPA! %s kl %s: %s %s ±%d m [%.5f,%.5f,%d,%d]",
            myName(c), hhmm(l.getTime()), ddm(l.getLatitude(), "N", "S"), ddm(l.getLongitude(), "A", "V"),
            Math.round(l.getAccuracy()), l.getLatitude(), l.getLongitude(), Math.round(l.getAccuracy()), l.getTime() / 1000);
        sendSms(c, phone, body);
    }

    /* ---------- Staðsetning barst frá félaga ---------- */
    static void handleLocation(Context c, String fromPhone, double lat, double lon, int acc, long tsSec, String via, String nameHint) {
        Context ctx = c.getApplicationContext();
        String k = last7(fromPhone);
        waiting.remove(k);
        JSONObject f = friend(ctx, fromPhone);
        String name = f != null && f.optString("name").length() > 0 ? f.optString("name") : (nameHint != null && nameHint.length() > 0 ? nameHint : fromPhone);
        try {
            JSONObject item = new JSONObject();
            item.put("name", name); item.put("phone", k); item.put("lat", lat); item.put("lon", lon);
            item.put("acc", acc); item.put("ts", tsSec); item.put("via", via);
            SharedPreferences p = prefs(ctx);
            JSONArray q = new JSONArray(p.getString("pending", "[]"));
            q.put(item);
            while (q.length() > 30) q.remove(0);
            p.edit().putString("pending", q.toString()).apply();
            JSObject ev = JSObject.fromJSONObject(item);
            FelagarPlugin.emit("location", ev);
        } catch (Exception e) { Log.w(TAG, "pending", e); }
        notify(ctx, 600 + Math.abs(k.hashCode() % 100), name + ": staðsetning barst",
               "kl " + hhmm(tsSec * 1000) + " · ±" + acc + " m · ýttu til að sjá á kortinu");
    }
    static void emitStatus(String k, String state) {
        try { JSObject o = new JSObject(); o.put("phone", k); o.put("state", state); FelagarPlugin.emit("status", o); } catch (Exception ignored) {}
    }

    /* ---------- SMS sem kemur inn ---------- */
    static void onSms(Context c, String from, String body) {
        if (body == null) return;
        String b = body.trim();
        if (b.startsWith("RJUPA?")) { handleRequest(c, from, "sms"); return; }
        if (b.startsWith("RJUPA!")) {
            Matcher m = LOC.matcher(b);
            if (m.find()) {
                try {
                    handleLocation(c, from, Double.parseDouble(m.group(1)), Double.parseDouble(m.group(2)),
                        Integer.parseInt(m.group(3)), Long.parseLong(m.group(4)), "sms", null);
                } catch (Exception e) { Log.w(TAG, "parse", e); }
            } else if (friend(c, from) != null) {
                notify(c, 700, friendName(c, from) + " svaraði", b.substring(6).trim());
            }
        }
    }

    /* ---------- ntfy skilaboð sem koma inn ---------- */
    static void onNtfy(Context c, String b64) {
        String g = group(c);
        if (g.length() < 4) return;
        try {
            JSONObject m = new JSONObject(decrypt(g, b64));
            long ts = m.optLong("ts", 0);
            if (System.currentTimeMillis() / 1000 - ts > 15 * 60) return;   // gamalt
            String from = m.optString("from");
            if ("req".equals(m.optString("t"))) handleRequest(c, from, "ntfy");
            else if ("loc".equals(m.optString("t")))
                handleLocation(c, from, m.getDouble("lat"), m.getDouble("lon"), m.optInt("acc"), ts, "net", m.optString("name"));
        } catch (Exception e) { Log.i(TAG, "ntfy: gat ekki lesið (rangur hópkóði?)"); }
    }

    /* ---------- Hjálparföll ---------- */
    static boolean publish(String topic, String body) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(NTFY + topic).openConnection();
            con.setConnectTimeout(8000); con.setReadTimeout(8000);
            con.setRequestMethod("POST"); con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "text/plain");
            try (OutputStream os = con.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
            int code = con.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) { Log.i(TAG, "publish: " + e); return false; }
        finally { if (con != null) con.disconnect(); }
    }
    static void sendSms(Context c, String phone, String text) {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            notify(c, 800, "Vantar leyfi til að senda SMS", "Opnaðu S. Másson → Stillingar → Félagar → Leyfa SMS.");
            return;
        }
        try {
            SmsManager sm = Build.VERSION.SDK_INT >= 31 ? c.getSystemService(SmsManager.class) : SmsManager.getDefault();
            ArrayList<String> parts = sm.divideMessage(text);
            sm.sendMultipartTextMessage(dialable(phone), null, parts, null, null);
        } catch (Exception e) { Log.w(TAG, "sms", e); }
    }
    interface LocCb { void done(Location l); }
    static void currentLocation(Context c, LocCb cb) {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            cb.done(null); return;
        }
        final FusedLocationProviderClient fl = LocationServices.getFusedLocationProviderClient(c);
        final CancellationTokenSource cts = new CancellationTokenSource();
        final AtomicBoolean finished = new AtomicBoolean(false);
        final Runnable fallback = () -> {
            if (finished.getAndSet(true)) return;
            cts.cancel();
            try {
                fl.getLastLocation().addOnCompleteListener(t -> cb.done(t.isSuccessful() ? t.getResult() : null));
            } catch (SecurityException e) { cb.done(null); }
        };
        MAIN.postDelayed(fallback, 20000);
        try {
            fl.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.getToken()).addOnCompleteListener(t -> {
                Location l = t.isSuccessful() ? t.getResult() : null;
                if (l == null) { MAIN.removeCallbacks(fallback); fallback.run(); return; }
                if (finished.getAndSet(true)) return;
                MAIN.removeCallbacks(fallback);
                cb.done(l);
            });
        } catch (SecurityException e) { MAIN.removeCallbacks(fallback); fallback.run(); }
    }
    static void notify(Context c, int id, String title, String text) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "Félagar", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Þegar félagi biður um staðsetningu eða svarar");
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(c, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
                .setSmallIcon(R.drawable.ic_stat_rjupa).setColor(0xFFE8590C)
                .setContentTitle(title).setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(pi);
            nm.notify(id, b.build());
        } catch (Exception e) { Log.w(TAG, "notify", e); }
    }
    static String hhmm(long ms) { return new SimpleDateFormat("HH:mm", Locale.US).format(new Date(ms)); }
    static String ddm(double v, String pos, String neg) {
        double a = Math.abs(v); int d = (int) Math.floor(a); double m = (a - d) * 60;
        return String.format(Locale.US, "%d°%06.3f'%s", d, m, v >= 0 ? pos : neg).replace('.', ',');
    }
}
