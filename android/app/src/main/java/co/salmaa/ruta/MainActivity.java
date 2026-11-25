package co.salmaa.ruta;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.Priority;

import java.util.Locale;

/**
 * Abre la app web publicada de Seguimiento de Ruta SST con acceso al GPS, pantalla encendida
 * durante la ruta y voz nativa (el WebView de Android no trae speechSynthesis). Al iniciar o
 * reanudar la ruta pide el permiso de ubicación y que el conductor encienda el GPS.
 */
public class MainActivity extends Activity {
    private static final int LOCATION_REQUEST = 1;
    private static final int ROUTE_PERMISSION_REQUEST = 2;
    private static final int ENABLE_LOCATION_REQUEST = 3;
    private static final String[] LOCATION_PERMISSIONS = {
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};

    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private GeolocationPermissions.Callback pendingGeolocation;
    private String pendingOrigin;
    /** "permiso" o "gps" mientras el conductor está en Ajustes; se revisa al volver. */
    private String waitingSettings;
    /** Color de las barras del sistema (azul de la app). */
    private static final int BAR_COLOR = 0xFF052866;
    private FrameLayout root;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // El conductor necesita ver la velocidad y las alertas sin que la pantalla se apague.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // La app dibuja detrás de las barras del sistema (obligatorio desde Android 15) y deja su espacio con
        // relleno, para que la hora y la batería no tapen la barra «Vas por».
        root = new FrameLayout(this);
        root.setBackgroundColor(BAR_COLOR);
        setContentView(root);
        drawBehindSystemBars();
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = bars.left; top = bars.top; right = bars.right; bottom = bars.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(left, top, right, bottom);
            return insets;
        });

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        web = createWebView();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            if (tts.setLanguage(new Locale("es", "CO")) < 0) tts.setLanguage(new Locale("es"));
            ttsReady = true;
        });

        if (!hasLocationPermission()) requestPermissions(LOCATION_PERMISSIONS, LOCATION_REQUEST);
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(BuildConfig.APP_URL);
    }

    @SuppressWarnings("deprecation")
    private void drawBehindSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
    }

    /** Crea el visor de la página (también al recuperarlo si el motor web se cae). */
    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SalmaaAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new AppBridge(), "SalmaaAndroid");
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

            // Botón «Ampliar mapa»: la página pide pantalla completa y la app muestra ese elemento encima de todo.
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
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

            // Si el motor web se cae (p. ej. sin memoria con el mapa 3D), se recrea y recarga en vez de cerrar la app.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view != MainActivity.this.web) return true;
                exitFullscreen();
                root.removeView(view);
                view.destroy();
                MainActivity.this.web = createWebView();
                root.addView(MainActivity.this.web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                MainActivity.this.web.loadUrl(BuildConfig.APP_URL);
                return true;
            }
        });
        return web;
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (pendingGeolocation != null) {
            pendingGeolocation.invoke(pendingOrigin, hasLocationPermission(), false);
            pendingGeolocation = null;
            pendingOrigin = null;
        }
        if (requestCode != ROUTE_PERMISSION_REQUEST) return;
        if (hasLocationPermission()) ensureLocationOn();
        else if (!shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)) {
            // Marcado «No volver a preguntar»: Android ya no muestra el diálogo, solo queda Ajustes.
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null));
            offerSettings("permiso", "Permite la ubicación",
                    "Ruta SST necesita tu ubicación para seguir la ruta y avisarte si te pasas del límite. En Ajustes, toca Permisos > Ubicación > Permitir.", details);
        } else reportLocation(false, "permiso");
    }

    /** Al iniciar o reanudar la ruta: paso 1, permiso de ubicación. */
    private void ensureLocation() {
        if (hasLocationPermission()) ensureLocationOn();
        else requestPermissions(LOCATION_PERMISSIONS, ROUTE_PERMISSION_REQUEST);
    }

    /** Paso 2, GPS encendido: diálogo de Google de un toque o, sin Google Play Services, Ajustes de ubicación. */
    private void ensureLocationOn() {
        if (isLocationOn()) {
            reportLocation(true, "");
            return;
        }
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000).build();
        LocationSettingsRequest settings = new LocationSettingsRequest.Builder().addLocationRequest(request).setAlwaysShow(true).build();
        try {
            LocationServices.getSettingsClient(this).checkLocationSettings(settings)
                    .addOnSuccessListener(this, result -> reportLocation(true, ""))
                    .addOnFailureListener(this, error -> {
                        if (error instanceof ResolvableApiException) {
                            try {
                                ((ResolvableApiException) error).startResolutionForResult(this, ENABLE_LOCATION_REQUEST);
                                return;
                            } catch (IntentSender.SendIntentException ignored) {
                            }
                        }
                        offerLocationSettings();
                    });
        } catch (RuntimeException noPlayServices) {
            offerLocationSettings();
        }
    }

    private void offerLocationSettings() {
        offerSettings("gps", "Enciende el GPS",
                "Ruta SST necesita la ubicación del celular encendida para seguir la ruta y avisarte si te pasas del límite.",
                new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
    }

    private void offerSettings(String reason, String title, String message, Intent intent) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("Abrir ajustes", (dialog, which) -> {
                    waitingSettings = reason;
                    try {
                        startActivity(intent);
                    } catch (ActivityNotFoundException e) {
                        waitingSettings = null;
                        reportLocation(false, reason);
                    }
                })
                .setNegativeButton("Cancelar", (dialog, which) -> reportLocation(false, reason))
                .setOnCancelListener(dialog -> reportLocation(false, reason))
                .show();
    }

    private boolean isLocationOn() {
        LocationManager manager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return manager.isLocationEnabled();
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    /** Responde a la página: ok=true si ya puede leer el GPS; si no, el motivo ("permiso" o "gps"). */
    private void reportLocation(boolean ok, String reason) {
        web.evaluateJavascript("window.salmaaLocationResult&&window.salmaaLocationResult(" + ok + ",'" + reason + "')", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == ENABLE_LOCATION_REQUEST) reportLocation(resultCode == RESULT_OK || isLocationOn(), "gps");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (waitingSettings == null) return;
        String reason = waitingSettings;
        waitingSettings = null;
        if (!reason.equals("permiso")) reportLocation(isLocationOn(), "gps");
        else if (hasLocationPermission()) ensureLocationOn();
        else reportLocation(false, "permiso");
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
        if (fullscreenView != null) exitFullscreen();
        else if (web.canGoBack()) web.goBack();
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

    /** Puente con la página: voz nativa para «Vas por…» y las alertas, y GPS listo antes de la ruta. */
    private class AppBridge {
        @JavascriptInterface
        public void speak(String text) {
            if (ttsReady && text != null && !text.isEmpty()) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "salmaa");
        }

        @JavascriptInterface
        public void stopSpeaking() {
            if (ttsReady) tts.stop();
        }

        /** Llamado al tocar «Iniciar ruta» o «Reanudar GPS»; responde con window.salmaaLocationResult. */
        @JavascriptInterface
        public void ensureLocation() {
            runOnUiThread(MainActivity.this::ensureLocation);
        }
    }
}
