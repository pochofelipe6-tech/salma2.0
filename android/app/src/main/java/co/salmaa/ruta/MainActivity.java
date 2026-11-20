package co.salmaa.ruta;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.Locale;

/**
 * Abre la app web publicada de Seguimiento de Ruta SST con acceso al GPS, pantalla encendida
 * durante la ruta y voz nativa (el WebView de Android no trae speechSynthesis).
 */
public class MainActivity extends Activity {
    private static final int LOCATION_REQUEST = 1;
    private static final String[] LOCATION_PERMISSIONS = {
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};

    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private GeolocationPermissions.Callback pendingGeolocation;
    private String pendingOrigin;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // El conductor necesita ver la velocidad y las alertas sin que la pantalla se apague.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SalmaaAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new VoiceBridge(), "SalmaaAndroid");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingOrigin = origin;
                    pendingGeolocation = callback;
                    requestPermissions(LOCATION_PERMISSIONS, LOCATION_REQUEST);
                }
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                Uri app = Uri.parse(BuildConfig.APP_URL);
                if (app.getHost() != null && app.getHost().equalsIgnoreCase(target.getHost())) return false;
                // Enlaces externos (correo de confirmación, OpenStreetMap...) se abren en el navegador.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline(view);
            }
        });

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            if (tts.setLanguage(new Locale("es", "CO")) < 0) tts.setLanguage(new Locale("es"));
            ttsReady = true;
        });

        if (!hasLocationPermission()) requestPermissions(LOCATION_PERMISSIONS, LOCATION_REQUEST);
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(BuildConfig.APP_URL);
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != LOCATION_REQUEST || pendingGeolocation == null) return;
        pendingGeolocation.invoke(pendingOrigin, hasLocationPermission(), false);
        pendingGeolocation = null;
        pendingOrigin = null;
    }

    private void showOffline(WebView view) {
        String html = "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<body style='font-family:sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;color:#072563;padding:20px'>"
                + "<div><h2>Sin conexión</h2><p>No se pudo abrir Seguimiento de Ruta. Revisa los datos móviles o el Wi-Fi.</p>"
                + "<button style='font-size:18px;padding:12px 22px;border:0;border-radius:12px;background:#0752ff;color:#fff' "
                + "onclick=\"location.href='" + BuildConfig.APP_URL + "'\">Reintentar</button></div></body></html>";
        view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Voz nativa para los anuncios «Vas por…» y las alertas de velocidad. */
    private class VoiceBridge {
        @JavascriptInterface
        public void speak(String text) {
            if (ttsReady && text != null && !text.isEmpty()) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "salmaa");
        }

        @JavascriptInterface
        public void stopSpeaking() {
            if (ttsReady) tts.stop();
        }
    }
}
