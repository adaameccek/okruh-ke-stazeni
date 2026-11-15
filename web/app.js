import {
  ZPUSOBY, Sit, kruh, obrys, vyhlad, median, vzdalenost,
  casText, kmText, hodnotaText, zPosuvniku, naPosuvnik, dotazVeFronte,
} from './dojezd.js';
import { Mapa, naX, naY } from './mapa.js?v=1';

const $ = (id) => document.getElementById(id);
const BARVY = ['#e4472b', '#1e6fd9', '#2b9a58', '#8a45c9', '#c08a00', '#d8317f'];
const KLIC = 'okruh-stav';
const VYCHOZI = { hodnota: 100, jednotka: 'km', zpusob: 'vzdusnou' };

let okruhy = [];
let vybrany = null;
let ja = null; // moje poloha
let bezPolohy = false;
let cil = null; // klepnuté místo s bublinou
let dalsiBarva = 0;
let cekaPrepocet = 0;

const site = new Map();
function sitPro(lat, lon, zpusob) {
  const klic = `${lat.toFixed(4)},${lon.toFixed(4)},${zpusob}`;
  if (!site.has(klic)) {
    if (site.size > 40) site.delete(site.keys().next().value);
    site.set(klic, new Sit(lat, lon, zpusob));
  }
  return site.get(klic);
}

// ---------- zásobník vrstev: Zpět zavře jen tu horní ----------
const vrstvy = [];
function otevriVrstvu(zavri) {
  vrstvy.push(zavri);
  history.pushState({ okruh: vrstvy.length }, '');
}
function zavriVrstvu(zavri) {
  if (vrstvy[vrstvy.length - 1] === zavri) history.back();
}
addEventListener('popstate', () => vrstvy.pop()?.());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && vrstvy.length) history.back();
});

// ---------- výpočet okruhu ----------
function prepocti(o) {
  const km = o.hodnota;
  if (o.zpusob === 'vzdusnou') {
    o.body = kruh(o.lat, o.lon, km);
    o.polomery = null;
    o.odhad = false;
    o.polomer = km;
  } else {
    const h = sitPro(o.lat, o.lon, o.zpusob).hranice(o.hodnota, o.jednotka);
    o.polomery = vyhlad(h.r);
    o.body = obrys(o.lat, o.lon, o.polomery);
    o.odhad = h.odhadu > h.r.length * 0.1;
    o.polomer = median(o.polomery);
  }
  o.mx = o.body.map((b) => naX(b.lon));
  o.my = o.body.map((b) => naY(b.lat));
}

async function dotahni(o) {
  const token = (o.token = (o.token || 0) + 1);
  const platne = () => o.token === token && okruhy.includes(o);
  try {
    if (o.zpusob !== 'vzdusnou') {
      const s = sitPro(o.lat, o.lon, o.zpusob);
      for (let kolo = 0; kolo < 6; kolo++) {
        const plan = s.planHranice(o.hodnota, o.jednotka);
        if (!plan.length) break;
        if (!(await s.nacti(plan, platne))) return;
        prepocti(o);
        mapa.prekresli();
        if (o === vybrany) obnovPanel();
      }
      prepocti(o);
      mapa.prekresli();
    }
    if (o === vybrany) await dotahniPrevody(o, platne);
    o.chyba = false;
  } catch (e) {
    if (!platne()) return;
    o.chyba = true;
    // Server se časem vrátí sám; zkoušet nejvýš jednou za minutu, ať ho to nezahltí.
    setTimeout(() => {
      if (platne()) dotahni(o);
    }, 60000);
  }
  if (o === vybrany) obnovPanel();
}

// Převodní čísla pod tlačítky. Skutečně se dopočítává jen auto; kolo a chůzi odhadne z délky
// cesty a přesně je změří, až je Adam zvolí, protože každý další dotaz znamená 10 s čekání.
async function dotahniPrevody(o, platne) {
  if (o.zpusob === 'auto') return;
  const s = sitPro(o.lat, o.lon, 'auto');
  const plan = s.planPolomeru(o.polomer);
  if (plan.length && (await s.nacti(plan, platne)) && o === vybrany) obnovPanel();
}

function prevod(o, zpusob) {
  const m = ZPUSOBY[zpusob];
  const s = sitPro(o.lat, o.lon, zpusob).souhrn(o.polomer);
  if (s) return { ...s, jiste: true };
  const auto = sitPro(o.lat, o.lon, 'auto').souhrn(o.polomer);
  const d = auto ? auto.d : o.polomer * m.faktor;
  return { t: (d / (m.kmh * m.faktor)) * 60, d, jiste: false };
}

function zmena(o, { hned = false, ukazat = false } = {}) {
  prepocti(o);
  mapa.prekresli();
  obnovPanel();
  uloz();
  clearTimeout(cekaPrepocet);
  cekaPrepocet = setTimeout(() => dotahni(o), hned ? 0 : 320);
  if (ukazat) ukazOkruh(o);
}

function vnitrniOkraje() {
  const p = $('panel').getBoundingClientRect();
  const m = $('mapa').getBoundingClientRect();
  // Na telefonu je panel pod mapou, na šířku leží přes její levou část.
  const vlevo = p.top < m.bottom - 1 && p.left - m.left < 40 ? Math.max(0, p.right - m.left) : 0;
  return { l: 30 + vlevo, r: 30, t: 40, b: 30 };
}

// Přesun jen když okruh není celý vidět nebo je na mapě moc malý; jinak mapa stojí.
function ukazOkruh(o) {
  const okraje = vnitrniOkraje();
  const body = o.body.filter((_, i) => i % 6 === 0);
  const px = body.map((b) => mapa.bod(b.lat, b.lon));
  const [x1, x2] = [Math.min(...px.map((b) => b.x)), Math.max(...px.map((b) => b.x))];
  const [y1, y2] = [Math.min(...px.map((b) => b.y)), Math.max(...px.map((b) => b.y))];
  const venku = x1 < okraje.l - 10 || x2 > mapa.w - okraje.r + 10 || y1 < okraje.t - 10 || y2 > mapa.h - okraje.b + 10;
  const maly = x2 - x1 < (mapa.w - okraje.l - okraje.r) * 0.3 && y2 - y1 < (mapa.h - okraje.t - okraje.b) * 0.3;
  if (venku || maly) mapa.ukaz(body, okraje);
}

function ukazVse() {
  mapa.ukaz(okruhy.flatMap((o) => o.body.filter((_, i) => i % 6 === 0)), vnitrniOkraje());
}

// ---------- kreslení ----------
function cestaOkruhu(ctx, o) {
  const svet = mapa.svet;
  const ox = mapa.w / 2 - mapa.cx * svet;
  const oy = mapa.h / 2 - mapa.cy * svet;
  const n = o.mx.length;
  ctx.beginPath();
  if (o.polomery) {
    // málo bodů: oblé přechody přes středy úseček
    const x = (i) => o.mx[(i + n) % n] * svet + ox;
    const y = (i) => o.my[(i + n) % n] * svet + oy;
    ctx.moveTo((x(-1) + x(0)) / 2, (y(-1) + y(0)) / 2);
    for (let i = 0; i < n; i++) ctx.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
  } else {
    for (let i = 0; i < n; i++) ctx.lineTo(o.mx[i] * svet + ox, o.my[i] * svet + oy);
  }
  ctx.closePath();
}

function popisek(o) {
  const z = ZPUSOBY[o.zpusob].kratce;
  return `${hodnotaText(o.hodnota, o.jednotka)}${z ? ` ${z}` : ''}`;
}

const tmava = matchMedia('(prefers-color-scheme: dark)');

function kresli(ctx) {
  for (const o of okruhy) {
    if (o === vybrany) continue;
    kresliOkruh(ctx, o);
  }
  if (vybrany) kresliOkruh(ctx, vybrany);
  if (cil && vybrany) {
    const a = mapa.bod(vybrany.lat, vybrany.lon);
    const b = mapa.bod(cil.lat, cil.lon);
    ctx.setLineDash([2, 6]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = tmava.matches ? '#eceae4' : '#17191d';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, 7);
    ctx.fill();
    umistiBublinu(b);
  }
  if (ja) {
    const p = mapa.bod(ja.lat, ja.lon);
    ctx.fillStyle = 'rgba(30,111,217,.18)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#1e6fd9';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6.5, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
}

function kresliOkruh(ctx, o) {
  const hlavni = o === vybrany;
  cestaOkruhu(ctx, o);
  ctx.fillStyle = o.barva + (hlavni ? '26' : '12');
  ctx.fill();
  ctx.strokeStyle = o.barva;
  ctx.lineWidth = hlavni ? 2.75 : 1.75;
  ctx.setLineDash(o.odhad ? [8, 6] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  // špendlík ve středu
  const s = mapa.bod(o.lat, o.lon);
  ctx.fillStyle = o.barva;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, hlavni ? 8 : 6, 0, 7);
  ctx.fill();
  ctx.stroke();

  // popisek na nejvyšším bodě okruhu, přečtený i přes mapu díky obtažení
  let nej = 0;
  for (let i = 1; i < o.my.length; i++) if (o.my[i] < o.my[nej]) nej = i;
  const x = mapa.bod(o.body[nej].lat, o.body[nej].lon);
  const py = Math.max(16, x.y);
  if (x.x > -40 && x.x < mapa.w + 40) {
    ctx.font = '700 18px "Barlow Condensed", Barlow, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = tmava.matches ? 'rgba(18,20,23,.92)' : 'rgba(255,255,255,.95)';
    ctx.strokeText(popisek(o), x.x, py);
    ctx.fillStyle = o.barva;
    ctx.fillText(popisek(o), x.x, py);
  }
}

// ---------- panel ----------
// Tlačítka zůstávají a mění se jen jejich obsah: panel se překresluje i uprostřed klepnutí
// (opuštění políčka, dorazivší výpočet) a nahrazené tlačítko by klepnutí ztratilo.
function tlacitka(rodic, popisy) {
  while (rodic.children.length > popisy.length) rodic.lastElementChild.remove();
  popisy.forEach((p, i) => {
    let b = rodic.children[i];
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      rodic.append(b);
    }
    b.className = p.trida;
    if (p.barva) b.style.setProperty('--b', p.barva);
    else b.style.removeProperty('--b');
    b.onclick = p.klik;
    b.replaceChildren(...p.obsah());
  });
}

function obnovPanel() {
  const o = vybrany;
  tlacitka($('okruhy'), [
    ...okruhy.map((x) => ({
      trida: x === o ? 'vybrany' : '',
      barva: x.barva,
      klik: () => vyber(x),
      obsah: () => {
        const t = document.createElement('span');
        t.textContent = popisek(x);
        const m = document.createElement('small');
        m.textContent = x.nazev || '';
        t.append(m);
        return [document.createElement('i'), t];
      },
    })),
    { trida: 'pridat', klik: otevriPridani, obsah: () => ['+ Okruh'] },
  ]);
  if (!o) return;
  document.documentElement.style.setProperty('--b', o.barva);
  const cislo = $('cislo');
  if (document.activeElement !== cislo) cislo.value = cisloText(o.hodnota);
  cislo.style.width = `${Math.max(2, String(cislo.value).length) + 0.8}ch`;
  document.querySelectorAll('.jednotky button').forEach((b) => b.classList.toggle('vybrany', b.dataset.jednotka === o.jednotka));
  const posuvnik = $('posuvnik');
  if (document.activeElement !== posuvnik || !posuvnik.dataset.tah) posuvnik.value = naPosuvnik(o.hodnota, o.jednotka);
  posuvnik.style.setProperty('--p', `${posuvnik.value * 100}%`);
  $('misto-nazev').textContent = o.nazev || '';

  tlacitka($('zpusoby'), Object.keys(ZPUSOBY).map((klic) => {
    let cislo_;
    let jiste = true;
    if (klic === 'vzdusnou') {
      cislo_ = kmText(o.polomer);
      jiste = !o.odhad;
    } else {
      const p = prevod(o, klic);
      // zadané minuty se ukazují přesně, ne zpětně přepočtené z tvaru okruhu
      cislo_ = casText(klic === o.zpusob && o.jednotka === 'min' ? o.hodnota : p.t);
      jiste = p.jiste;
    }
    return {
      trida: `${klic === o.zpusob ? 'vybrany' : ''}${jiste ? '' : ' odhad'}`,
      klik: () => zvolZpusob(o, klic),
      obsah: () => {
        const c = document.createElement('b');
        c.textContent = (jiste ? '' : '≈ ') + cislo_;
        return [c, ZPUSOBY[klic].nazev];
      },
    };
  }));
  $('poznamka').textContent = poznamka(o);
}

function poznamka(o) {
  if (o.chyba) return 'Mapový server neodpověděl, čísla jsou jen odhad.';
  if (o.zpusob === 'vzdusnou') {
    const s = sitPro(o.lat, o.lon, 'auto').souhrn(o.polomer);
    if (!s) return 'Počítám cestu…';
    return `Autem k okraji ${casText(s.tOd)} až ${casText(s.tDo)} podle směru, bez kolon.`;
  }
  if (o.odhad) return 'Počítám cestu…';
  const r = [...o.polomery].sort((a, b) => a - b);
  const od = r[Math.round(r.length * 0.1)];
  const do_ = r[Math.round(r.length * 0.9)];
  const s = sitPro(o.lat, o.lon, o.zpusob).souhrn(o.polomery);
  const silnice = o.jednotka === 'min' && s ? `, po silnici ${kmText(s.d)}` : '';
  const cas = o.jednotka === 'km' && s ? `, cesta ${casText(s.t)}` : '';
  return `Podle směru ${kmText(od)} až ${kmText(do_)} vzdušnou${silnice}${cas}.${o.zpusob === 'auto' ? ' Bez kolon.' : ''}`;
}

function cisloText(v) {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

function vyber(o) {
  if (vybrany === o) {
    ukazOkruh(o);
    return;
  }
  vybrany = o;
  zavriBublinu();
  obnovPanel();
  mapa.prekresli();
  uloz();
  dotahni(o);
}

function zvolZpusob(o, klic) {
  if (o.zpusob === klic) return;
  // vzdušnou se měří jen v kilometrech: minuty se převedou na dosah
  if (klic === 'vzdusnou' && o.jednotka === 'min') {
    o.hodnota = zaokrouhli(o.polomer);
    o.jednotka = 'km';
  }
  o.zpusob = klic;
  zmena(o, { hned: true, ukazat: true });
}

function zvolJednotku(o, jednotka) {
  if (o.jednotka === jednotka) return;
  if (jednotka === 'min') {
    const zpusob = o.zpusob === 'vzdusnou' ? 'auto' : o.zpusob;
    const p = prevod({ ...o, zpusob: o.zpusob }, zpusob);
    o.hodnota = zaokrouhli(p.t);
    o.zpusob = zpusob;
  } else {
    const s = sitPro(o.lat, o.lon, o.zpusob).souhrn(o.polomery);
    o.hodnota = zaokrouhli(s ? s.d : o.polomer * ZPUSOBY[o.zpusob].faktor);
  }
  o.jednotka = jednotka;
  zmena(o, { hned: true, ukazat: true });
}

function zaokrouhli(v) {
  return v < 10 ? Math.max(1, Math.round(v * 2) / 2) : Math.round(v);
}

function nazvy(o) {
  if (o.ja) {
    o.nazev = 'Moje poloha';
    return;
  }
  const { lat, lon } = o;
  o.nazev = o.nazev || '';
  fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=cs&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`)
    .then((r) => r.json())
    .then((j) => {
      const a = j.address || {};
      const n = a.village || a.town || a.city_district || a.suburb || a.city || a.municipality || a.county || a.state || a.country;
      if (n && o.lat === lat && o.lon === lon) {
        o.nazev = n;
        obnovPanel();
        uloz();
      }
    })
    .catch(() => {});
}

function pridejOkruh(lat, lon, { nazev = '', jaBod = false } = {}) {
  const vzor = vybrany || VYCHOZI;
  const o = {
    lat, lon, nazev, ja: jaBod,
    hodnota: vzor.hodnota, jednotka: vzor.jednotka, zpusob: vzor.zpusob,
    barva: BARVY[dalsiBarva++ % BARVY.length],
  };
  okruhy.push(o);
  vybrany = o;
  if (!nazev) nazvy(o);
  prepocti(o);
  zavriPridani();
  zavriBublinu();
  zobrazPohled();
  obnovPanel();
  uloz();
  dotahni(o);
  requestAnimationFrame(() => (okruhy.length > 1 ? ukazVse() : ukazOkruh(o)));
}

function smazOkruh(o) {
  okruhy = okruhy.filter((x) => x !== o);
  vybrany = okruhy[okruhy.length - 1] || null;
  zavriBublinu();
  zobrazPohled();
  obnovPanel();
  mapa.prekresli();
  uloz();
  if (vybrany) dotahni(vybrany);
}

// ---------- přidání místa ----------
let pridani = false;

function zobrazPohled() {
  const bez = !okruhy.length;
  $('pohled-pridat').hidden = !(pridani || bez);
  $('pohled-okruhy').hidden = pridani || bez;
  $('zpet').hidden = bez;
  if (pridani || bez) nabidkaZakladni();
}

function otevriPridani() {
  if (pridani) return;
  pridani = true;
  zavriBublinu();
  otevriVrstvu(zavreniPridani);
  zobrazPohled();
  $('hledat').value = '';
  $('hledat').focus({ preventScroll: true });
}
function zavreniPridani() {
  pridani = false;
  zobrazPohled();
}
function zavriPridani() {
  if (pridani) zavriVrstvu(zavreniPridani);
}

function polozkaNabidky(hlavni, vedlejsi, akce) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = hlavni;
  if (vedlejsi) {
    const s = document.createElement('small');
    s.textContent = vedlejsi;
    b.append(s);
  }
  b.addEventListener('click', akce);
  li.append(b);
  return li;
}

function nabidkaZakladni() {
  const polozky = [];
  if (ja) polozky.push(polozkaNabidky('Moje poloha', '', () => pridejOkruh(ja.lat, ja.lon, { nazev: 'Moje poloha', jaBod: true })));
  if (vybrany) polozky.push(polozkaNabidky(`Stejné místo: ${vybrany.nazev || 'vybraný bod'}`, '', () => pridejOkruh(vybrany.lat, vybrany.lon, { nazev: vybrany.nazev, jaBod: vybrany.ja })));
  $('nabidka').replaceChildren(...polozky);
  $('napoveda').textContent = !ja && !bezPolohy && !okruhy.length ? 'Zjišťuju polohu. Nebo napiš místo či klepni do mapy.'
    : bezPolohy && !okruhy.length ? 'Polohu nemám. Napiš místo nebo klepni do mapy.'
      : 'Nebo klepni do mapy.';
}

let cekaHledani = 0;
let hledaniCislo = 0;
function hledej(text) {
  clearTimeout(cekaHledani);
  const q = text.trim();
  if (q.length < 2) {
    nabidkaZakladni();
    return;
  }
  const cislo = ++hledaniCislo;
  cekaHledani = setTimeout(async () => {
    const u = vybrany || ja;
    const pobliz = u ? `&lat=${u.lat.toFixed(2)}&lon=${u.lon.toFixed(2)}` : '&lat=49.8&lon=15.4';
    try {
      const odp = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=default${pobliz}`);
      const j = await odp.json();
      if (cislo !== hledaniCislo) return;
      const videne = new Set();
      const polozky = [];
      for (const f of j.features || []) {
        const p = f.properties;
        const hlavni = [p.name || p.street, p.housenumber].filter(Boolean).join(' ') || p.city;
        const vedlejsi = [p.city !== hlavni ? p.city : '', p.county, p.country].filter(Boolean).join(', ');
        const klic = `${hlavni}|${vedlejsi}`;
        if (!hlavni || videne.has(klic)) continue;
        videne.add(klic);
        const [lon, lat] = f.geometry.coordinates;
        polozky.push(polozkaNabidky(hlavni, vedlejsi, () => pridejOkruh(lat, lon, { nazev: hlavni })));
      }
      $('nabidka').replaceChildren(...polozky);
      $('napoveda').textContent = polozky.length ? 'Nebo klepni do mapy.' : 'Nic takového nevidím. Zkus to jinak nebo klepni do mapy.';
    } catch {
      if (cislo === hledaniCislo) $('napoveda').textContent = 'Hledání teď nejde. Klepni do mapy.';
    }
  }, 300);
}

// ---------- klepnutí do mapy ----------
function zavreniBubliny() {
  cil = null;
  $('bublina').hidden = true;
  mapa.prekresli();
}
function zavriBublinu() {
  if (cil) zavriVrstvu(zavreniBubliny);
}

function umistiBublinu(b) {
  const el = $('bublina');
  if (el.hidden) return;
  const sirka = el.offsetWidth;
  const vyska = el.offsetHeight;
  const x = Math.max(8, Math.min(mapa.w - sirka - 8, b.x - sirka / 2));
  const y = b.y - vyska - 14 < 8 ? b.y + 14 : b.y - vyska - 14;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

async function klepnuto(lat, lon) {
  if (pridani || !okruhy.length) {
    pridejOkruh(lat, lon);
    return;
  }
  const o = vybrany;
  if (!cil) otevriVrstvu(zavreniBubliny);
  const tento = (cil = { lat, lon });
  $('bublina').hidden = false;
  const zpusob = o.zpusob === 'vzdusnou' ? 'auto' : o.zpusob;
  const vzdusnou = vzdalenost(o.lat, o.lon, lat, lon);
  const vedlejsi = (t) => {
    $('bublina-text').innerHTML = `<b>${kmText(vzdusnou)}</b> vzdušnou<small>${t}</small>`;
    mapa.prekresli();
  };
  vedlejsi('Počítám cestu…');
  try {
    const [v] = await dotazVeFronte(ZPUSOBY[zpusob].sluzba, o, [{ lat, lon }]);
    if (cil !== tento) return;
    if (v.t == null) vedlejsi('Cesta se nenašla.');
    else vedlejsi(`${casText(v.t / 60)} ${ZPUSOBY[zpusob].kratce}, ${kmText(v.d / 1000)} po silnici`);
  } catch {
    if (cil === tento) vedlejsi('Cestu teď nejde spočítat.');
  }
}

// ---------- úchop špendlíku ----------
let drzeny = null;
function uchop(x, y) {
  let nej = null;
  let vzd = 26;
  for (const o of okruhy) {
    const p = mapa.bod(o.lat, o.lon);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < vzd || (o === vybrany && d === vzd)) {
      nej = o;
      vzd = d;
    }
  }
  drzeny = nej;
  return !!nej;
}
function tah(lat, lon) {
  const o = drzeny;
  zavriBublinu();
  o.lat = lat;
  o.lon = lon;
  o.ja = false;
  // při tažení se nese poslední známý tvar, přesný se dopočítá po puštění
  if (o.zpusob === 'vzdusnou') prepocti(o);
  else {
    o.body = obrys(lat, lon, o.polomery);
    o.mx = o.body.map((b) => naX(b.lon));
    o.my = o.body.map((b) => naY(b.lat));
  }
  mapa.prekresli();
}
function pust(posunuto) {
  const o = drzeny;
  drzeny = null;
  if (!o) return;
  if (!posunuto) {
    vyber(o);
    return;
  }
  vybrany = o;
  o.nazev = '';
  nazvy(o);
  zmena(o, { hned: true });
}

// ---------- uložení ----------
function uloz() {
  try {
    localStorage.setItem(KLIC, JSON.stringify({
      okruhy: okruhy.map(({ lat, lon, nazev, ja: j, hodnota, jednotka, zpusob, barva }) => ({ lat, lon, nazev, ja: j, hodnota, jednotka, zpusob, barva })),
      vybrany: okruhy.indexOf(vybrany),
      dalsiBarva,
    }));
  } catch { /* bez úložiště se jen nepamatuje */ }
}
function nacti() {
  try {
    const s = JSON.parse(localStorage.getItem(KLIC) || 'null');
    if (!s?.okruhy?.length) return;
    okruhy = s.okruhy;
    dalsiBarva = s.dalsiBarva || okruhy.length;
    vybrany = okruhy[s.vybrany] || okruhy[0];
    okruhy.forEach(prepocti);
  } catch { /* poškozený záznam: začátek od nuly */ }
}

// ---------- poloha ----------
let prvniPoloha = true;
function polohaPrisla(lat, lon) {
  ja = { lat, lon };
  bezPolohy = false;
  $('ja').classList.remove('bez');
  // okruh „moje poloha" jde se mnou, ale kvůli pár metrům se nepřepočítává
  for (const o of okruhy) {
    if (o.ja && vzdalenost(o.lat, o.lon, lat, lon) > 0.4) {
      o.lat = lat;
      o.lon = lon;
      zmena(o, { hned: true });
    }
  }
  if (prvniPoloha) {
    prvniPoloha = false;
    if (!okruhy.length) pridejOkruh(lat, lon, { nazev: 'Moje poloha', jaBod: true });
  }
  if (!okruhy.length) nabidkaZakladni();
  mapa.prekresli();
}
function polohaNeni() {
  bezPolohy = true;
  $('ja').classList.add('bez');
  if (!okruhy.length) nabidkaZakladni();
}
window.okruhPoloha = polohaPrisla;
window.okruhBezPolohy = polohaNeni;

function sledujPolohu() {
  if (window.OkruhApp) {
    window.OkruhApp.sledujPolohu();
    return;
  }
  if (!navigator.geolocation) {
    polohaNeni();
    return;
  }
  const ok = (p) => polohaPrisla(p.coords.latitude, p.coords.longitude);
  navigator.geolocation.getCurrentPosition(ok, polohaNeni, { maximumAge: 120000, timeout: 8000 });
  navigator.geolocation.watchPosition(ok, () => {}, { enableHighAccuracy: true, maximumAge: 15000 });
}

// ---------- spuštění ----------
const mapa = new Mapa($('mapa'), {
  dlazdice: $('dlazdice'),
  vrstva: $('vrstva'),
  volby: { kresli, uchop, tah, pust, klep: klepnuto },
});

$('cislo').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value.replace(',', '.'));
  const o = vybrany;
  e.target.style.width = `${Math.max(2, e.target.value.length) + 0.8}ch`;
  if (!o || !(v > 0)) return;
  o.hodnota = Math.min(v, o.zpusob === 'vzdusnou' ? 5000 : o.jednotka === 'km' ? 1500 : 3000);
  zmena(o);
});
$('cislo').addEventListener('focus', (e) => e.target.select());
$('cislo').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
});
$('cislo').addEventListener('change', () => {
  if (vybrany) ukazOkruh(vybrany);
  obnovPanel();
});
const posuvnik = $('posuvnik');
posuvnik.addEventListener('input', () => {
  const o = vybrany;
  if (!o) return;
  posuvnik.dataset.tah = '1';
  o.hodnota = zPosuvniku(+posuvnik.value, o.jednotka);
  zmena(o);
});
posuvnik.addEventListener('change', () => {
  delete posuvnik.dataset.tah;
  if (vybrany) ukazOkruh(vybrany);
});
document.querySelectorAll('.jednotky button').forEach((b) => {
  b.addEventListener('click', () => vybrany && zvolJednotku(vybrany, b.dataset.jednotka));
});
$('smazat').addEventListener('click', () => vybrany && smazOkruh(vybrany));
$('hledat').addEventListener('input', (e) => hledej(e.target.value));
$('zpet').addEventListener('click', zavriPridani);
$('bublina-okruh').addEventListener('click', () => {
  const c = cil;
  if (c) pridejOkruh(c.lat, c.lon);
});
$('ja').addEventListener('click', () => {
  if (ja) mapa.prelet(naX(ja.lon), naY(ja.lat), Math.max(mapa.z, 11));
  else sledujPolohu();
});
tmava.addEventListener('change', () => mapa.prekresli());
document.fonts?.ready.then(() => mapa.prekresli());

nacti();
zobrazPohled();
obnovPanel();
mapa.prekresli();
if (okruhy.length) {
  requestAnimationFrame(ukazVse);
  okruhy.forEach((o) => o !== vybrany && o.zpusob !== 'vzdusnou' && dotahni(o));
  if (vybrany) dotahni(vybrany);
}
sledujPolohu();
