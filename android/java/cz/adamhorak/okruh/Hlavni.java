package cz.adamhorak.okruh;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.util.Locale;

/** Obal webového rozhraní: stránky z assets pod vlastní adresou a poloha z telefonu. */
public class Hlavni extends Activity {
    // Dlaždice OpenStreetMap chtějí Referer, takže stránka musí mít skutečnou adresu, ne file://.
    private static final String HOST = "okruh.adamhorak.cz";
    private static final String ADRESA = "https://" + HOST + "/";
    private static final int ZADOST_POLOHA = 1;
    private static final long PRESNA_PLATI_MS = 120000;

    private WebView web;
    private LocationManager polohy;
    private boolean chcePolohu;
    private boolean sleduje;
    private Location posledni;

    private final LocationListener posluchac = new LocationListener() {
        @Override
        public void onLocationChanged(Location l) {
            // hrubá poloha ze sítě nesmí přebít čerstvou z GPS, okruh by skákal a přepočítával se
            boolean horsi = posledni != null && l.getAccuracy() > posledni.getAccuracy()
                    && l.getTime() - posledni.getTime() < PRESNA_PLATI_MS;
            if (!horsi) posliPolohu(l);
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
        }

        @Override
        public void onProviderEnabled(String provider) {
        }

        @Override
        public void onProviderDisabled(String provider) {
        }
    };

    @Override
    protected void onCreate(Bundle stav) {
        super.onCreate(stav);
        polohy = (LocationManager) getSystemService(LOCATION_SERVICE);
        web = new WebView(this);
        setContentView(web);
        WebSettings n = web.getSettings();
        n.setJavaScriptEnabled(true);
        n.setDomStorageEnabled(true);
        n.setAllowFileAccess(false);
        n.setAllowContentAccess(false);
        n.setTextZoom(100);
        web.setBackgroundColor(getColor(R.color.pozadi));
        web.addJavascriptInterface(new Most(), "OkruhApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                return HOST.equals(u.getHost()) ? zAssets(u.getPath()) : null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (HOST.equals(r.getUrl().getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl()));
                } catch (RuntimeException e) {
                    // žádná appka odkaz neotevře, stránka zůstane
                }
                return true;
            }
        });
        web.loadUrl(ADRESA);
    }

    private WebResourceResponse zAssets(String cesta) {
        String soubor = cesta == null || cesta.equals("/") ? "index.html" : cesta.substring(1);
        if (soubor.contains("..")) return null;
        try {
            return new WebResourceResponse(typ(soubor), "utf-8", getAssets().open("web/" + soubor));
        } catch (IOException e) {
            WebResourceResponse nic = new WebResourceResponse("text/plain", "utf-8", null);
            nic.setStatusCodeAndReasonPhrase(404, "Not Found");
            return nic;
        }
    }

    private static String typ(String soubor) {
        if (soubor.endsWith(".html")) return "text/html";
        if (soubor.endsWith(".js")) return "text/javascript";
        if (soubor.endsWith(".css")) return "text/css";
        if (soubor.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private final class Most {
        @JavascriptInterface
        public void sledujPolohu() {
            runOnUiThread(() -> {
                chcePolohu = true;
                if (maPravo()) spustSledovani();
                else requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, ZADOST_POLOHA);
            });
        }
    }

    private boolean maPravo() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int kod, String[] prava, int[] vysledky) {
        if (kod != ZADOST_POLOHA) return;
        if (maPravo()) {
            spustSledovani();
        } else {
            chcePolohu = false;
            web.evaluateJavascript("okruhBezPolohy()", null);
        }
    }

    private void spustSledovani() {
        if (sleduje || !maPravo()) return;
        Location nejlepsi = null;
        boolean nejakyZdroj = false;
        for (String zdroj : new String[] {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
            try {
                if (!polohy.isProviderEnabled(zdroj)) continue;
                nejakyZdroj = true;
                polohy.requestLocationUpdates(zdroj, 5000, 25, posluchac);
                Location l = polohy.getLastKnownLocation(zdroj);
                if (l != null && (nejlepsi == null || l.getTime() > nejlepsi.getTime())) nejlepsi = l;
            } catch (SecurityException | IllegalArgumentException e) {
                // zdroj v telefonu není nebo právo mezitím zmizelo, zkusí se další
            }
        }
        sleduje = nejakyZdroj;
        if (nejlepsi != null) posliPolohu(nejlepsi);
        else if (!nejakyZdroj) web.evaluateJavascript("okruhBezPolohy()", null);
    }

    private void zastavSledovani() {
        polohy.removeUpdates(posluchac);
        sleduje = false;
    }

    private void posliPolohu(Location l) {
        posledni = l;
        web.evaluateJavascript(String.format(Locale.ROOT, "okruhPoloha(%.6f,%.6f)", l.getLatitude(), l.getLongitude()), null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (chcePolohu) spustSledovani();
    }

    @Override
    protected void onPause() {
        zastavSledovani();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
