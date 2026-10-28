package is.gombiman.rjupnakort;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;

/** Takkar í Másson-tilkynningunni: Pása, Halda áfram, Ljúka ferð. */
public class HuntActionReceiver extends BroadcastReceiver {
    static final String ACTION = "is.gombiman.rjupnakort.HUNT";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        String a = intent.getStringExtra("a");
        if (a == null) return;
        // Geymt líka ef kortið er ekki tilbúið: það sækir aðgerðina þegar það vaknar
        Felagar.prefs(ctx).edit().putString("huntAction", a).putLong("huntActionTs", System.currentTimeMillis()).apply();
        if ("pause".equals(a) || "resume".equals(a)) { ZoneNotif.paused = "pause".equals(a); ZoneNotif.refresh(ctx); }
        JSObject o = new JSObject(); o.put("a", a);
        FelagarPlugin.emit("huntAction", o);
    }
}
