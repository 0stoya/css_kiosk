package uk.co.csscdn.kiosk;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.GeneralSecurityException;

public final class MainActivity extends Activity {
    private static final String TAG = "CSSKioskShell";
    private static final String KIOSK_URL = "https://kiosk.csscdn.co.uk/";
    private static final String KIOSK_HOST = "kiosk.csscdn.co.uk";

    private WebView webView;
    private View errorPanel;
    private TextView errorTitle;
    private TextView errorDetail;
    private NfcAdapter nfcAdapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.kiosk_webview);
        errorPanel = findViewById(R.id.error_panel);
        errorTitle = findViewById(R.id.error_title);
        errorDetail = findViewById(R.id.error_detail);
        Button retryButton = findViewById(R.id.retry_button);

        retryButton.setOnClickListener(view -> {
            hideError();
            webView.loadUrl(KIOSK_URL);
        });

        configureWebView();
        configureDeviceIdentity();
        configureNfc();
        enterImmersiveMode();
        webView.loadUrl(KIOSK_URL);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                () -> { }
            );
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(
            settings.getUserAgentString() + " CSSKioskAndroid/" + BuildConfig.VERSION_NAME
        );

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);
        webView.setWebViewClient(new KioskWebViewClient());
    }

    private void configureDeviceIdentity() {
        try {
            DeviceIdentity identity = new DeviceIdentity();
            Log.i(TAG, "Android Keystore identity ready: " + identity.deviceId());
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Public device JWK: " + identity.publicJwkJson());
            }
        } catch (GeneralSecurityException exception) {
            Log.e(TAG, "Android Keystore identity unavailable", exception);
        }
    }

    private void configureNfc() {
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        if (nfcAdapter == null) {
            Log.w(TAG, "No Android NFC adapter reported by this device");
            return;
        }
        Log.i(TAG, "Android NFC adapter present; enabled=" + nfcAdapter.isEnabled());
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        enableNfcReaderMode();
    }

    @Override
    protected void onPause() {
        if (nfcAdapter != null) {
            try {
                nfcAdapter.disableReaderMode(this);
            } catch (RuntimeException exception) {
                Log.w(TAG, "Could not disable NFC reader mode", exception);
            }
        }
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Deliberately do nothing. The kiosk must not navigate into browser/history UI.
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(new WebViewClient());
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }

    private void enableNfcReaderMode() {
        if (nfcAdapter == null || !nfcAdapter.isEnabled()) return;

        int flags =
            NfcAdapter.FLAG_READER_NFC_A |
            NfcAdapter.FLAG_READER_NFC_B |
            NfcAdapter.FLAG_READER_NFC_F |
            NfcAdapter.FLAG_READER_NFC_V |
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK |
            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;

        Bundle options = new Bundle();
        options.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250);

        try {
            nfcAdapter.enableReaderMode(this, this::onTagDiscovered, flags, options);
            Log.i(TAG, "NFC reader mode enabled");
        } catch (RuntimeException exception) {
            Log.e(TAG, "Could not enable NFC reader mode", exception);
        }
    }

    private void onTagDiscovered(Tag tag) {
        String uid = toHex(tag.getId());
        String[] technologies = tag.getTechList();
        Log.i(TAG, "NFC tag discovered uid=" + uid + " tech=" + joinTechnologies(technologies));

        JSONObject detail = new JSONObject();
        try {
            detail.put("uid", uid);
            detail.put("capturedAt", System.currentTimeMillis());
            JSONArray tech = new JSONArray();
            for (String technology : technologies) tech.put(technology);
            detail.put("technologies", tech);
        } catch (JSONException exception) {
            Log.w(TAG, "Could not encode NFC diagnostic event", exception);
            return;
        }

        // Diagnostic bridge only. Authentication remains server-side until native
        // trusted-device enrollment/signing is wired in.
        runOnUiThread(() -> {
            String currentUrl = webView.getUrl();
            if (!isAllowedKioskUrl(currentUrl)) return;
            String script =
                "window.dispatchEvent(new CustomEvent('css-kiosk:nfc-tag',{detail:" +
                detail.toString() +
                "}));";
            webView.evaluateJavascript(script, null);
        });
    }

    private void enterImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
            return;
        }

        @SuppressWarnings("deprecation")
        int flags =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    private boolean isAllowedKioskUrl(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        Uri uri = Uri.parse(value);
        return "https".equalsIgnoreCase(uri.getScheme()) &&
            KIOSK_HOST.equalsIgnoreCase(uri.getHost());
    }

    private void showError(String title, String detail) {
        runOnUiThread(() -> {
            errorTitle.setText(title);
            errorDetail.setText(detail);
            errorPanel.setVisibility(View.VISIBLE);
        });
    }

    private void hideError() {
        errorPanel.setVisibility(View.GONE);
    }

    private static String toHex(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format("%02X", item));
        return value.toString();
    }

    private static String joinTechnologies(String[] technologies) {
        StringBuilder value = new StringBuilder();
        for (String technology : technologies) {
            if (value.length() > 0) value.append(',');
            value.append(technology);
        }
        return value.toString();
    }

    private final class KioskWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String target = request.getUrl().toString();
            if (isAllowedKioskUrl(target)) return false;
            Log.w(TAG, "Blocked WebView navigation outside kiosk origin: " + target);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (isAllowedKioskUrl(url)) hideError();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (isAllowedKioskUrl(url)) hideError();
        }

        @Override
        public void onReceivedError(
            WebView view,
            WebResourceRequest request,
            WebResourceError error
        ) {
            if (!request.isForMainFrame()) return;
            CharSequence description = error.getDescription();
            showError(
                "Kiosk unavailable",
                description == null || description.length() == 0
                    ? "Check the network connection and try again."
                    : description.toString()
            );
        }

        @Override
        public void onReceivedHttpError(
            WebView view,
            WebResourceRequest request,
            WebResourceResponse errorResponse
        ) {
            if (!request.isForMainFrame() || errorResponse.getStatusCode() < 500) return;
            showError(
                "Kiosk service unavailable",
                "The kiosk server returned " + errorResponse.getStatusCode() + ". Try again shortly."
            );
        }

        @Override
        public void onReceivedSslError(
            WebView view,
            SslErrorHandler handler,
            SslError error
        ) {
            handler.cancel();
            Log.e(TAG, "Blocked kiosk TLS error: " + error);
            showError(
                "Secure connection failed",
                "The kiosk could not verify the server certificate."
            );
        }
    }
}
