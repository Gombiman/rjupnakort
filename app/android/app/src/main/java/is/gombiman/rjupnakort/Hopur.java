package is.gombiman.rjupnakort;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.Locale;

/**
 * Sameiginleg stigatafla hópsins (Másson-stig).
 * Hver sími sendir dulkóðaða stöðu sína á hóprás sem reiknuð er úr hópkóðanum.
 * Í veiðiham hlustar NtfyListener líka á þessa rás og lætur vita þegar félagi fellir rjúpu.
 */
final class Hopur {
    /** Er appið sýnilegt? (MainActivity uppfærir) */
    static volatile boolean visible = false;

    private Hopur() {}

    static String topic(String group) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(("group|" + group).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder("rk_g_");
            for (int i = 0; i < 12; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) { return "rk_g_invalid"; }
    }

    static boolean send(Context c, String json) {
        String g = Felagar.group(c);
        if (g.length() < 4) return false;
        try { return Felagar.publish(topic(g), Felagar.encrypt(g, json)); }
        catch (Exception e) { Log.i(Felagar.TAG, "hópur send: " + e); return false; }
    }

    /** Sækir skilaboð á hóprásinni frá „since“ (t.d. "12h" eða auðkenni síðustu skilaboða). */
    static JSObject fetch(Context c, String since) throws Exception {
        String g = Felagar.group(c);
        JSArray items = new JSArray();
        String last = null;
        JSObject r = new JSObject();
        if (g.length() < 4) { r.put("items", items); return r; }
        HttpURLConnection con = (HttpURLConnection) new URL(Felagar.NTFY + topic(g) + "/json?poll=1&since="
            + URLEncoder.encode(since == null || since.isEmpty() ? "12h" : since, "UTF-8")).openConnection();
        try {
            con.setConnectTimeout(10000); con.setReadTimeout(20000);
            try (BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    JSONObject ev = new JSONObject(line);
                    if (!"message".equals(ev.optString("event"))) continue;
                    last = ev.optString("id", last);
                    try { items.put(new JSObject(Felagar.decrypt(g, ev.optString("message")))); }
                    catch (Exception ignored) { /* annar hópkóði eða skemmt */ }
                }
            }
        } finally { con.disconnect(); }
        r.put("items", items);
        if (last != null) r.put("last", last);
        return r;
    }

    /** Skilaboð sem berast í rauntíma (NtfyListener). */
    static void onMessage(Context c, String b64) {
        String g = Felagar.group(c);
        if (g.length() < 4) return;
        try {
            JSObject m = new JSObject(Felagar.decrypt(g, b64));
            if (Felagar.last7(Felagar.myPhone(c)).equals(m.optString("id"))) return;   // eigin skilaboð
            FelagarPlugin.emit("group", m);
            long ts = m.optLong("ts", 0);
            if (!visible && "kill".equals(m.optString("t")) && System.currentTimeMillis() - ts < 30 * 60 * 1000L) {
                boolean masson = Felagar.prefs(c).getBoolean("masson", true);
                String name = m.optString("name", "Félagi");
                int n = m.optInt("today", 1);
                String title = masson ? nick(c, name) + " fékk Másson-stig! 🦃" : name + " skráði rjúpu";
                Felagar.notify(c, 3000 + Math.abs(m.optString("id").hashCode() % 500), title, n + " í dag");
            }
        } catch (Exception e) { Log.i(Felagar.TAG, "hópur: gat ekki lesið"); }
    }

    private static String norm(String t) {
        String s = (t == null ? "" : t).toLowerCase(Locale.ROOT)
            .replace("ð", "d").replace("þ", "th").replace("æ", "ae").replace("ö", "o");
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").trim();
    }

    /** Gælunafn samkvæmt töflunni úr stillingum („Grétar = Gretzky“, ein lína á mann). */
    static String nick(Context c, String name) {
        String table = Felagar.prefs(c).getString("nicks", "");
        String n = norm(name);
        for (String line : table.split("\n")) {
            int i = line.indexOf('=');
            if (i <= 0) continue;
            String k = norm(line.substring(0, i)), v = line.substring(i + 1).trim();
            if (k.isEmpty() || v.isEmpty()) continue;
            if (n.equals(k) || n.startsWith(k + " ")) return v;
        }
        return name;
    }
}
