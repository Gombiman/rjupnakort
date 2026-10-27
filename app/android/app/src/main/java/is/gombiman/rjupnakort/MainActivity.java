package is.gombiman.rjupnakort;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FelagarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
