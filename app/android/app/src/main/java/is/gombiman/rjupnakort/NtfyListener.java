package is.gombiman.rjupnakort;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashSet;

/**
 * Hlustar á eigin ntfy-rás (reiknuð úr hópkóða + eigin númeri).
 * Keyrir á meðan veiðihamur er virkur, og í nokkrar mínútur eftir að beðið er um staðsetningu félaga.
 */
final class NtfyListener {
    private static Thread thread;
    private static volatile long until = 0;
    private static volatile boolean stopFlag = false;
    private static volatile HttpURLConnection current;
    private static final HashSet<String> seen = new HashSet<>();
    private static final ArrayDeque<String> seenOrder = new ArrayDeque<>();

    private NtfyListener() {}

    /** Hlusta að minnsta kosti í durationMs (eða alltaf á meðan veiðihamur er virkur). */
    static synchronized void ensure(Context c, long durationMs) {
        until = Math.max(until, System.currentTimeMillis() + durationMs);
        start(c);
    }

    static synchronized void apply(Context c) {
        if (Felagar.hunt(c) && Felagar.group(c).length() >= 4 && Felagar.myPhone(c).length() > 0) start(c);
        else if (System.currentTimeMillis() > until) stop();
    }

    static synchronized void restart(Context c) { stop(); apply(c); }

    private static boolean wanted(Context c) {
        return Felagar.group(c).length() >= 4 && Felagar.myPhone(c).length() > 0
            && (Felagar.hunt(c) || System.currentTimeMillis() < until);
    }

    private static synchronized void start(Context c) {
        final Context ctx = c.getApplicationContext();
        if (thread != null && thread.isAlive()) return;
        if (!wanted(ctx)) return;
        stopFlag = false;
        thread = new Thread(() -> loop(ctx), "ntfy-listener");
        thread.setDaemon(true);
        thread.start();
    }

    static synchronized void stop() {
        stopFlag = true;
        HttpURLConnection con = current;
        if (con != null) try { con.disconnect(); } catch (Exception ignored) {}
    }

    private static void loop(Context ctx) {
        long backoff = 3000;
        String since = "2m";
        while (!stopFlag && wanted(ctx)) {
            String topic = Felagar.topic(Felagar.group(ctx), Felagar.myPhone(ctx));
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(Felagar.NTFY + topic + "/json?since=" + since).openConnection();
                con.setConnectTimeout(10000);
                con.setReadTimeout(90000);   // ntfy sendir keepalive á ~45 sek fresti
                current = con;
                try (BufferedReader r = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) {
                    backoff = 3000;
                    String line;
                    while (!stopFlag && (line = r.readLine()) != null) {
                        if (!wanted(ctx)) { stopFlag = true; break; }
                        JSONObject ev = new JSONObject(line);
                        if (!"message".equals(ev.optString("event"))) continue;
                        String id = ev.optString("id");
                        since = id.length() > 0 ? id : since;
                        if (!remember(id)) continue;
                        Felagar.onNtfy(ctx, ev.optString("message"));
                    }
                }
            } catch (Exception e) {
                if (!stopFlag) Log.i(Felagar.TAG, "ntfy tenging rofnaði: " + e);
            } finally {
                if (con != null) con.disconnect();
                current = null;
            }
            if (stopFlag) break;
            try { Thread.sleep(backoff); } catch (InterruptedException ie) { break; }
            backoff = Math.min(backoff * 2, 60000);
        }
        synchronized (NtfyListener.class) { thread = null; }
    }

    private static synchronized boolean remember(String id) {
        if (id == null || id.isEmpty()) return true;
        if (seen.contains(id)) return false;
        seen.add(id); seenOrder.add(id);
        while (seenOrder.size() > 200) seen.remove(seenOrder.poll());
        return true;
    }
}
