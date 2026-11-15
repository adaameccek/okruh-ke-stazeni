# -*- coding: utf-8 -*-
r"""
Veřejná stránka ke stažení Okruhu (https://okruh.adamhorak.cz) k už sestavenému APK.

    py -3.12 android\stranka.py          stránka + kopie APK, loga a snímku do ..\stahnout
    py -3.12 android\stranka.py --og     navíc znovu vyrobí náhled odkazu stahnout\og.jpg (1200x630)

Vstupy: dist\okruh.apk (py build.py), stahnout.sablona.html, og.sablona.html, ..\web\icon.svg,
telefon.png (snímek appky 1170x2532, vyrobí ..\tools\foto_telefon.py).
Nasazení: složka ..\stahnout jako Vercel projekt "okruh" (cd stahnout && vercel deploy --prod --yes).
Po každém novém APK: build.py, tenhle skript, deploy.
"""
import hashlib
import io
import os
import re
import shutil
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PROJ = os.path.dirname(os.path.abspath(__file__))     # ...\okruh\android
KOREN = os.path.dirname(PROJ)                          # ...\okruh
STAHNOUT = os.path.join(KOREN, "stahnout")
APK = os.path.join(PROJ, "dist", "okruh.apk")
IKONA = os.path.join(KOREN, "web", "icon.svg")
TELEFON = os.path.join(PROJ, "telefon.png")
SABLONA = os.path.join(PROJ, "stahnout.sablona.html")
SABLONA_OG = os.path.join(PROJ, "og.sablona.html")
ADRESA = "https://okruh.adamhorak.cz/"
AAPT2 = os.path.join(os.environ["LOCALAPPDATA"], "Android", "Sdk", "build-tools", "35.0.0", "aapt2.exe")
BUILD = os.path.join(os.environ["LOCALAPPDATA"], "okruh-build")
ANDROID = "Android 8+"                                  # MIN_SDK 26 v build.py

VERCEL = """{
  "cleanUrls": false,
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "X-Robots-Tag", "value": "noindex, nofollow" } ] },
    { "source": "/okruh.apk", "headers": [
      { "key": "Content-Type", "value": "application/vnd.android.package-archive" },
      { "key": "Content-Disposition", "value": "attachment; filename=\\"okruh.apk\\"" },
      { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" } ] },
    { "source": "/(index.html)?", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" } ] }
  ]
}
"""


def velikost_text(b):
    return "%d kB" % round(b / 1024) if b < 1024 * 1024 else ("%.1f MB" % (b / 1024 / 1024)).replace(".", ",")


def logo_svg(trida, dekor=False):
    """Logo z ..\\web\\icon.svg (jediný zdroj), vložené přímo do stránky."""
    svg = io.open(IKONA, encoding="utf-8").read().strip()
    popis = 'aria-hidden="true" focusable="false"' if dekor else 'role="img" aria-label="Logo Okruh"'
    return svg.replace("<svg ", '<svg class="%s" %s ' % (trida, popis), 1)


def qr_svg():
    """QR na stránku: 4 px na modul, viewBox kvůli škálování (segno ho sám nedá)."""
    import segno
    kod = segno.make(ADRESA, error="m")
    buf = io.BytesIO()
    kod.save(buf, kind="svg", scale=4, border=0, dark="#000", light="#fff",
             xmldecl=False, svgns=True, nl=False, svgclass="qr-kod")
    svg = buf.getvalue().decode("utf-8")
    m = re.search(r'width="(\d+)" height="(\d+)"', svg)
    return svg.replace(m.group(0), '%s viewBox="0 0 %s %s"' % (m.group(0), m.group(1), m.group(2)), 1)


def zkontroluj(html, co):
    zbylo = re.findall(r"\{\{[A-Z_]+\}\}", html)
    if zbylo:
        sys.exit("CHYBA: v %s zůstalo %s" % (co, ", ".join(sorted(set(zbylo)))))


def verze_apk():
    p = subprocess.run([AAPT2, "dump", "badging", APK], capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"versionCode='(\d+)' versionName='([^']*)'", p.stdout)
    if not m:
        sys.exit("CHYBA: z APK nejde přečíst verze\n" + p.stdout + p.stderr)
    return int(m.group(1)), m.group(2)


def og():
    """Náhled odkazu 1200x630 ze šablony: headless Edge přes Playwright -> JPEG."""
    import base64
    from playwright.sync_api import sync_playwright
    from PIL import Image
    telefon = "data:image/png;base64," + base64.b64encode(open(TELEFON, "rb").read()).decode()
    html = (io.open(SABLONA_OG, encoding="utf-8").read()
            .replace("{{LOGO}}", logo_svg("logo", dekor=True)).replace("{{TELEFON}}", telefon))
    zkontroluj(html, "náhledu og")
    os.makedirs(BUILD, exist_ok=True)
    png = os.path.join(BUILD, "og.png")
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True)
        pg = b.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        pg.set_content(html, wait_until="networkidle")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(300)
        pg.screenshot(path=png, clip={"x": 0, "y": 0, "width": 1200, "height": 630})
        b.close()
    cil = os.path.join(STAHNOUT, "og.jpg")
    Image.open(png).convert("RGB").save(cil, "JPEG", quality=86, optimize=True, progressive=True)
    print("  stahnout\\og.jpg  %s" % velikost_text(os.path.getsize(cil)))


def main():
    if not os.path.exists(APK):
        sys.exit("CHYBA: chybí dist\\okruh.apk, nejdřív py build.py")
    os.makedirs(STAHNOUT, exist_ok=True)
    data = open(APK, "rb").read()
    kod, nazev = verze_apk()
    shutil.copyfile(APK, os.path.join(STAHNOUT, "okruh.apk"))
    shutil.copyfile(IKONA, os.path.join(STAHNOUT, "icon.svg"))
    from PIL import Image
    # 900 px = ostré i na telefonu s hustotou 3x (rámeček má 300 px), menší soubor než plných 1170 px
    im = Image.open(TELEFON).convert("RGB")
    im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS).save(
        os.path.join(STAHNOUT, "telefon.jpg"), "JPEG", quality=80, optimize=True, progressive=True)
    html = (io.open(SABLONA, encoding="utf-8").read()
            .replace("{{KOD}}", str(kod)).replace("{{VERZE}}", nazev.split(" ")[0])
            .replace("{{ANDROID}}", ANDROID).replace("{{VELIKOST}}", velikost_text(len(data)))
            .replace("{{LOGO_DEKOR}}", logo_svg("logo", dekor=True)).replace("{{QR}}", qr_svg()))
    zkontroluj(html, "stránce")
    with io.open(os.path.join(STAHNOUT, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    with io.open(os.path.join(STAHNOUT, "vercel.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write(VERCEL)
    if "--og" in sys.argv or not os.path.exists(os.path.join(STAHNOUT, "og.jpg")):
        og()
    print("Stránka pro verzi %s (kód %d), APK %s, SHA-256 %s" % (nazev, kod, velikost_text(len(data)), hashlib.sha256(data).hexdigest()[:16]))


if __name__ == "__main__":
    main()
