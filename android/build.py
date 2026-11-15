# -*- coding: utf-8 -*-
r"""
Sestaví appku Okruh (cz.adamhorak.okruh) bez Android Studia a Gradlu, jen nástroji
z Android SDK. Postup je převzatý ze Stopek (stopky\android\build.py). Rozhraní je složka
web, zabalí se celá do assets\web.

    py build.py

Kroky: aapt2 compile/link -> javac -> d8 -> zipalign -> apksigner -> kontrola
Výsledek dist\okruh.apk.

Podpis: podpis\okruh.jks, heslo v C:\Users\info\.secrets\okruh-keystore.txt.
TÍMHLE KLÍČEM MUSÍ BÝT PODEPSANÁ KAŽDÁ DALŠÍ VERZE - jinak ji telefon nenainstaluje
přes starou a appka by se musela odinstalovat.
Mezivýsledky jdou mimo OneDrive do %LOCALAPPDATA%\okruh-build.
"""
import datetime
import io
import os
import secrets
import shutil
import stat
import subprocess
import sys
import time
import zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PROJ = os.path.dirname(os.path.abspath(__file__))     # ...\okruh\android
DIST = os.path.join(PROJ, "dist")
WEB = os.path.join(os.path.dirname(PROJ), "web")

SDK = os.path.join(os.environ["LOCALAPPDATA"], "Android", "Sdk")
BT = os.path.join(SDK, "build-tools", "35.0.0")
ANDROID_JAR = os.path.join(SDK, "platforms", "android-35", "android.jar")
BUILD = os.path.join(os.environ["LOCALAPPDATA"], "okruh-build")

KEYSTORE = os.path.join(PROJ, "podpis", "okruh.jks")
HESLO = os.path.join(os.path.expanduser("~"), ".secrets", "okruh-keystore.txt")
ALIAS = "okruh"

MIN_SDK = 26
TARGET_SDK = 34
NAZEV_APK = "okruh.apk"


def krok(nazev):
    print("\n== " + nazev)


def spust(args, **kw):
    """Spustí nástroj; .bat přes cmd. Při chybě vypíše výstup a skončí."""
    if args[0].lower().endswith(".bat"):
        args = ["cmd", "/c"] + args
    p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", **kw)
    if p.returncode != 0:
        print(p.stdout)
        print(p.stderr)
        jmeno = os.path.basename(args[2] if args[0] == "cmd" else args[0])
        sys.exit("CHYBA: %s skončil kódem %d" % (jmeno, p.returncode))
    return p.stdout + p.stderr


def java_soubory(koren):
    out = []
    for d, _, soubory in os.walk(koren):
        out += [os.path.join(d, s) for s in soubory if s.endswith(".java")]
    return sorted(out)


def verze():
    ted = datetime.datetime.now()
    kod = (ted.date() - datetime.date(2026, 1, 1)).days * 1440 + ted.hour * 60 + ted.minute
    nazev = "%d.%d.%d %d:%02d" % (ted.day, ted.month, ted.year, ted.hour, ted.minute)
    return kod, nazev


def zajisti_podpis():
    if os.path.exists(KEYSTORE):
        if not os.path.exists(HESLO):
            sys.exit("CHYBA: podpisový klíč existuje, ale chybí heslo %s" % HESLO)
        return
    if os.path.exists(HESLO):
        sys.exit("CHYBA: heslo existuje, ale chybí klíč %s - nic nepřepisuju" % KEYSTORE)
    os.makedirs(os.path.dirname(HESLO), exist_ok=True)
    os.makedirs(os.path.dirname(KEYSTORE), exist_ok=True)
    with open(HESLO, "w", encoding="ascii") as f:
        f.write(secrets.token_urlsafe(24) + "\n")
    spust(["keytool", "-genkeypair", "-keystore", KEYSTORE, "-storetype", "PKCS12",
           "-alias", ALIAS, "-keyalg", "RSA", "-keysize", "3072", "-validity", "36500",
           "-dname", "CN=Adam Horak, O=adamhorak.cz, C=CZ",
           "-storepass:file", HESLO, "-keypass:file", HESLO])
    print("  vytvořen nový podpisový klíč (heslo v %s)" % HESLO)


def uklid_build():
    """Smaže mezivýsledky; Windows (indexer, antivir) občas drží složku, tak několik pokusů."""
    for _ in range(10):
        # soubory jen pro čtení rmtree na Windows nesmaže, proto nejdřív zrušit příznak
        for koren, slozky, soubory in os.walk(BUILD):
            for jmeno in slozky + soubory:
                try:
                    os.chmod(os.path.join(koren, jmeno), stat.S_IWRITE | stat.S_IREAD)
                except OSError:
                    pass
        shutil.rmtree(BUILD, ignore_errors=True)
        if not os.path.exists(BUILD):
            return
        time.sleep(1)
    sys.exit("CHYBA: nejde smazat %s (něco ji drží)" % BUILD)


def main():
    kod, nazev = verze()
    print("Okruh, verze %s (kód %d)" % (nazev, kod))
    for p in (BT, ANDROID_JAR):
        if not os.path.exists(p):
            sys.exit("CHYBA: chybí %s" % p)

    uklid_build()
    for d in ("gen", "classes", "dex"):
        os.makedirs(os.path.join(BUILD, d))

    krok("rozhraní do assets")
    assets = os.path.join(BUILD, "assets")
    shutil.copytree(WEB, os.path.join(assets, "web"))
    print("  %d souborů" % len(os.listdir(WEB)))

    krok("zdroje (aapt2)")
    res_zip = os.path.join(BUILD, "res.zip")
    zaklad = os.path.join(BUILD, "zaklad.apk")
    spust([os.path.join(BT, "aapt2.exe"), "compile", "--dir", os.path.join(PROJ, "res"),
           "-o", res_zip])
    spust([os.path.join(BT, "aapt2.exe"), "link", "-o", zaklad, "-I", ANDROID_JAR,
           "--manifest", os.path.join(PROJ, "AndroidManifest.xml"), "-R", res_zip, "-A", assets,
           "--java", os.path.join(BUILD, "gen"), "--auto-add-overlay",
           "--min-sdk-version", str(MIN_SDK), "--target-sdk-version", str(TARGET_SDK),
           "--version-code", str(kod), "--version-name", nazev])

    krok("kompilace (javac)")
    zdrojaky = java_soubory(os.path.join(PROJ, "java")) + java_soubory(os.path.join(BUILD, "gen"))
    # android.jar nemá LambdaMetafactory, kterou javac na lambdy potřebuje; d8 je pak přepíše
    lambda_stuby = os.path.join(BT, "core-lambda-stubs.jar")
    vystup = spust(["javac", "-encoding", "UTF-8", "-source", "8", "-target", "8",
                    "-Xlint:-options", "-Xlint:unchecked",
                    "-bootclasspath", ANDROID_JAR + os.pathsep + lambda_stuby,
                    "-d", os.path.join(BUILD, "classes")] + zdrojaky)
    if vystup.strip():
        print(vystup.strip())
    print("  %d souborů" % len(zdrojaky))

    krok("dex (d8)")
    classes_jar = os.path.join(BUILD, "classes.jar")
    spust(["jar", "cf", classes_jar, "-C", os.path.join(BUILD, "classes"), "."])
    spust([os.path.join(BT, "d8.bat"), "--release", "--min-api", str(MIN_SDK),
           "--lib", ANDROID_JAR, "--output", os.path.join(BUILD, "dex"), classes_jar])
    dexy = sorted(f for f in os.listdir(os.path.join(BUILD, "dex")) if f.endswith(".dex"))
    if "classes.dex" not in dexy:
        sys.exit("CHYBA: d8 nevytvořil classes.dex")
    with zipfile.ZipFile(zaklad, "a", compression=zipfile.ZIP_DEFLATED) as z:
        for d in dexy:
            z.write(os.path.join(BUILD, "dex", d), d)
    print("  %s" % ", ".join(dexy))

    krok("zarovnání a podpis")
    zarovnano = os.path.join(BUILD, "zarovnano.apk")
    hotovo = os.path.join(BUILD, NAZEV_APK)
    spust([os.path.join(BT, "zipalign.exe"), "-p", "-f", "4", zaklad, zarovnano])
    zajisti_podpis()
    # jen --ks-pass: apksigner čte soubor s heslem po řádcích, druhé čtení téhož souboru
    # skončí na konci; heslo klíče se v PKCS12 bere stejné jako heslo úložiště
    spust([os.path.join(BT, "apksigner.bat"), "sign", "--ks", KEYSTORE,
           "--ks-key-alias", ALIAS, "--ks-pass", "file:" + HESLO,
           "--out", hotovo, zarovnano])

    krok("kontrola")
    podpis = spust([os.path.join(BT, "apksigner.bat"), "verify", "--verbose",
                    "--print-certs", hotovo])
    for radek in podpis.splitlines():
        if radek.startswith(("Verified using v2", "Verified using v3 ", "Signer #1 certificate DN")):
            print("  " + radek)
    if "Verifies" not in podpis:
        sys.exit("CHYBA: podpis neprošel")
    badging = spust([os.path.join(BT, "aapt2.exe"), "dump", "badging", hotovo])
    for radek in badging.splitlines():
        if radek.startswith(("package:", "minSdkVersion", "targetSdkVersion", "uses-permission",
                             "application-label:", "launchable-activity")):
            print("  " + radek)
    with zipfile.ZipFile(hotovo) as z:
        if "classes.dex" not in z.namelist():
            sys.exit("CHYBA: v APK chybí classes.dex")

    krok("výstupy")
    os.makedirs(DIST, exist_ok=True)
    cil = os.path.join(DIST, NAZEV_APK)
    shutil.copy2(hotovo, cil)
    print("  dist\\%s  %d kB" % (NAZEV_APK, round(os.path.getsize(cil) / 1024)))


main()
