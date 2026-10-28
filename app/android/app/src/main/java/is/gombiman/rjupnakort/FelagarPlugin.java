package is.gombiman.rjupnakort;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

@CapacitorPlugin(
    name = "Felagar",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS })
    }
)
public class FelagarPlugin extends Plugin {
    private static FelagarPlugin instance;

    @Override
    public void load() {
        instance = this;
        NtfyListener.apply(getContext());
    }

    static void emit(String event, JSObject data) {
        FelagarPlugin p = instance;
        if (p != null) p.notifyListeners(event, data, true);
    }

    // Staða svæðis í Másson-tilkynningunni: táknið (rjúpa með haki, X eða ?) og litur.
    // Uppfærir aðeins tilkynningu GPS-þjónustunnar ef hún er þegar á skjánum.
    @PluginMethod
    public void zone(PluginCall call) {
        if (call.getBoolean("paused") != null) ZoneNotif.paused = Boolean.TRUE.equals(call.getBoolean("paused"));
        ZoneNotif.update(getContext(), call.getString("kind", "q"), call.getString("title", ""), call.getString("text", ""));
        call.resolve();
    }

    @PluginMethod
    public void huntPaused(PluginCall call) {
        ZoneNotif.paused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        ZoneNotif.refresh(getContext());
        call.resolve();
    }

    // Aðgerð úr tilkynningunni sem kortið hefur ekki enn tekið við (yngri en 10 mín)
    @PluginMethod
    public void takeHuntAction(PluginCall call) {
        SharedPreferences p = Felagar.prefs(getContext());
        String a = p.getString("huntAction", null);
        long ts = p.getLong("huntActionTs", 0);
        p.edit().remove("huntAction").remove("huntActionTs").apply();
        JSObject r = new JSObject();
        if (a != null && System.currentTimeMillis() - ts < 600000) r.put("a", a);
        call.resolve(r);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        SharedPreferences.Editor e = Felagar.prefs(getContext()).edit();
        if (call.hasOption("myPhone")) e.putString("myPhone", call.getString("myPhone", ""));
        if (call.hasOption("myName")) e.putString("myName", call.getString("myName", ""));
        if (call.hasOption("group")) e.putString("group", call.getString("group", "").trim());
        if (call.hasOption("autoReply")) e.putBoolean("autoReply", Boolean.TRUE.equals(call.getBoolean("autoReply", true)));
        if (call.hasOption("hunt")) e.putBoolean("hunt", Boolean.TRUE.equals(call.getBoolean("hunt", false)));
        if (call.hasOption("masson")) e.putBoolean("masson", !Boolean.FALSE.equals(call.getBoolean("masson", true)));
        if (call.hasOption("nicks")) e.putString("nicks", call.getString("nicks", ""));
        if (call.hasOption("friends")) {
            JSArray a = call.getArray("friends", new JSArray());
            e.putString("friends", a.toString());
        }
        e.commit();
        NtfyListener.restart(getContext());
        call.resolve();
    }

    @PluginMethod
    public void find(PluginCall call) {
        String phone = call.getString("phone", "");
        if (Felagar.last7(phone).length() < 7) { call.reject("Ógilt símanúmer"); return; }
        String via = Felagar.requestFriend(getContext(), phone);
        JSObject r = new JSObject(); r.put("via", via); r.put("phone", Felagar.last7(phone));
        call.resolve(r);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        SharedPreferences p = Felagar.prefs(getContext());
        String s = p.getString("pending", "[]");
        p.edit().putString("pending", "[]").apply();
        JSObject r = new JSObject();
        try { r.put("items", new JSArray(new JSONArray(s).toString())); } catch (Exception ex) { r.put("items", new JSArray()); }
        call.resolve(r);
    }

    @PluginMethod
    public void listenUntil(PluginCall call) {
        Long until = call.getLong("until", 0L);
        HopurService.start(getContext(), until == null ? 0 : until);
        call.resolve();
    }

    @PluginMethod
    public void groupSend(PluginCall call) {
        final String msg = call.getString("msg", "");
        Felagar.IO.execute(() -> {
            JSObject r = new JSObject(); r.put("ok", Hopur.send(getContext(), msg));
            call.resolve(r);
        });
    }

    @PluginMethod
    public void groupFetch(PluginCall call) {
        final String since = call.getString("since", "12h");
        Felagar.IO.execute(() -> {
            try { call.resolve(Hopur.fetch(getContext(), since)); }
            catch (Exception ex) { call.reject("Ekkert samband: " + ex.getMessage()); }
        });
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(statusObj()); }

    private JSObject statusObj() {
        JSObject r = new JSObject();
        r.put("sms", getPermissionState("sms") == PermissionState.GRANTED);
        boolean fine = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean bg = Build.VERSION.SDK_INT < 29 ? fine
            : ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        r.put("location", fine);
        r.put("backgroundLocation", bg);
        r.put("telephony", getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY));
        return r;
    }

    @PluginMethod
    public void requestSms(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) { call.resolve(statusObj()); return; }
        requestPermissionForAlias("sms", call, "smsCallback");
    }

    @PermissionCallback
    private void smsCallback(PluginCall call) { call.resolve(statusObj()); }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
