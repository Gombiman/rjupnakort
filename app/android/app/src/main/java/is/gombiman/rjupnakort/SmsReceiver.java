package is.gombiman.rjupnakort;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

/** Tekur við SMS sem byrja á "RJUPA?" (beiðni) eða "RJUPA!" (svar). Annað er látið vera. */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (msgs == null || msgs.length == 0) return;
        StringBuilder body = new StringBuilder();
        String from = null;
        for (SmsMessage m : msgs) {
            if (m == null) continue;
            if (from == null) from = m.getOriginatingAddress();
            body.append(m.getMessageBody());
        }
        String b = body.toString().trim();
        if (from == null || !(b.startsWith("RJUPA?") || b.startsWith("RJUPA!"))) return;
        final PendingResult pr = goAsync();
        final String f = from;
        Felagar.onSms(context, f, b);
        // Gefum staðsetningu tíma til að klárast (handleRequest notar sína eigin bið)
        Felagar.MAIN.postDelayed(pr::finish, 25000);
    }
}
