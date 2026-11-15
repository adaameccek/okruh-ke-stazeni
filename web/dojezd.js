// Výpočet okruhů: geometrie na kouli a dojezd po silnici.
//
// Hotové izochrony na veřejném serveru končí na 60 min a 100 km, a každý posun by znamenal
// nový dotaz. Proto si kolem středu navzorkuju paprsky a soustředné kruhy (OSRM table vrátí
// čas i délku cesty ke stovce bodů naráz) a hranici dopočítám z nich. Posuvník pak překresluje
// tvar bez sítě a dotahuje se jen to, co chybí.

const R_ZEME = 6371.0088;
const RAD = Math.PI / 180;

export const ZPUSOBY = {
  vzdusnou: { nazev: 'Vzdušnou', kratce: '' },
  auto: { nazev: 'Autem', kratce: 'autem', sluzba: 'routed-car', kmh: 62, faktor: 1.3 },
  kolo: { nazev: 'Na kole', kratce: 'na kole', sluzba: 'routed-bike', kmh: 13, faktor: 1.25 },
  pesky: { nazev: 'Pěšky', kratce: 'pěšky', sluzba: 'routed-foot', kmh: 4, faktor: 1.25 },
};

export const PAPRSKU = 40;

// Pevná řada poloměrů, ať se vzorky dají použít znovu při jakémkoli rozsahu.
const POLOMERY = [];
for (let r = 0.25; r <= 1600; r *= 1.22) POLOMERY.push(r);

export function vzdalenost(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_ZEME * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bodNaPaprsku(lat, lon, azimut, km) {
  const d = km / R_ZEME;
  const t = azimut * RAD;
  const f1 = lat * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = lon * RAD + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
}

export function kruh(lat, lon, km, bodu = 180) {
  const out = [];
  for (let i = 0; i < bodu; i++) out.push(bodNaPaprsku(lat, lon, (i * 360) / bodu, km));
  return out;
}

export function obrys(lat, lon, polomery) {
  return polomery.map((r, i) => bodNaPaprsku(lat, lon, (i * 360) / polomery.length, r));
}

export function median(pole) {
  if (!pole.length) return null;
  const s = [...pole].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentil(pole, p) {
  const s = [...pole].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round((s.length - 1) * p))];
}

// Jeden vzorek bokem (silnice těsně za řekou, dálnice jen v jednom paprsku) nesmí udělat špičku.
export function vyhlad(r) {
  const n = r.length;
  const med = r.map((_, i) => median([r[(i + n - 1) % n], r[i], r[(i + 1) % n]]));
  return med.map((_, i) => (med[(i + n - 1) % n] + 2 * med[i] + med[(i + 1) % n]) / 4);
}

const ROZESTUP = 10500;
const PAUZA_PO_ODMITNUTI = 60000;

export async function stahniTabulku(sluzba, stred, body, signal) {
  const souradnice = [stred, ...body].map((b) => `${b.lon.toFixed(4)},${b.lat.toFixed(4)}`).join(';');
  const url = `https://routing.openstreetmap.de/${sluzba}/table/v1/driving/${souradnice}?sources=0&annotations=duration,distance&generate_hints=false`;
  zamkni(ROZESTUP);
  const odp = await fetch(url, { signal });
  if (odp.status === 429) zamkni(PAUZA_PO_ODMITNUTI);
  if (!odp.ok) throw new Error(`routing ${odp.status}`);
  const j = await odp.json();
  if (j.code !== 'Ok') throw new Error(`routing ${j.code}`);
  return body.map((_, i) => ({
    t: j.durations[0][i + 1],
    d: j.distances[0][i + 1],
    odskok: j.destinations[i + 1]?.distance ?? 0,
  }));
}

// Veřejný server dostane vždy jen jeden dotaz naráz a s rozestupem. Limit je jeden dotaz za 10 s;
// opakované překročení znamená zablokovanou IP na delší dobu (ověřeno 31.10.2026), proto ho
// appka nesmí vůbec zkoušet, ani po znovuotevření. Rozestup se proto pamatuje i přes zavření.
let volnoOd = 0;
try {
  volnoOd = Number(localStorage.getItem('okruh-dotaz')) || 0;
} catch {}

function zamkni(ms) {
  volnoOd = Date.now() + ms;
  try {
    localStorage.setItem('okruh-dotaz', String(volnoOd));
  } catch {}
}

function rozestup() {
  const zbyva = Math.min(volnoOd - Date.now(), PAUZA_PO_ODMITNUTI);
  return zbyva > 0 ? new Promise((hotovo) => setTimeout(hotovo, zbyva)) : Promise.resolve();
}

let fronta = Promise.resolve();
function veFronte(ukol) {
  const vysledek = fronta.then(rozestup).then(ukol);
  fronta = vysledek.catch(() => {});
  return vysledek;
}

export const dotazVeFronte = (sluzba, stred, body) => veFronte(() => stahniTabulku(sluzba, stred, body));

// Server pouští jeden dotaz za 10 s (první hned), ale v jednom jich unese přes 380 bodů.
const POCET_NA_DOTAZ = 380;

export class Sit {
  constructor(lat, lon, zpusob, paprsku = PAPRSKU, stahni = stahniTabulku) {
    Object.assign(this, { lat, lon, zpusob, paprsku, stahni });
    this.kruhy = new Map(); // index poloměru -> pole vzorků po paprscích
    this.chyba = false;
  }

  // Vzorek se počítá, jen když cílový bod leží u silnice; jinak je to moře nebo pustina.
  platny(v, r) {
    if (!v || v.t == null || v.d == null) return null;
    return v.odskok <= Math.min(5000, Math.max(1500, r * 100)) ? { t: v.t / 60, d: v.d / 1000 } : null;
  }

  razeneKruhy() {
    return [...this.kruhy.keys()].sort((a, b) => a - b);
  }

  // Hranice dosahu po paprscích. Kde vzorky ještě nestačí, je to odhad z posledního vzorku.
  hranice(limit, jednotka) {
    const m = ZPUSOBY[this.zpusob];
    const indexy = this.razeneKruhy();
    const klic = jednotka === 'min' ? 't' : 'd';
    const zaklad = jednotka === 'min' ? (limit * m.kmh) / 60 : limit / m.faktor;
    const nejnizsi = indexy.length ? POLOMERY[indexy[0]] : Infinity;
    const r = [];
    let odhadu = 0;
    let prazdne = 0;
    for (let p = 0; p < this.paprsku; p++) {
      let predR = 0;
      let predV = 0;
      let nejdal = 0;
      let posledni = null;
      let protnuto = false;
      let platnych = 0;
      for (const i of indexy) {
        const v = this.kruhy.get(i)[p];
        posledni = v;
        if (!v) continue;
        platnych++;
        const rv = POLOMERY[i];
        const hod = v[klic];
        if (predV <= limit && hod >= limit) {
          const x = hod > predV ? (limit - predV) / (hod - predV) : 0;
          nejdal = Math.max(nejdal, predR + x * (rv - predR));
          protnuto = true;
        } else if (hod < limit) {
          nejdal = Math.max(nejdal, rv);
          protnuto = false;
        }
        predR = rv;
        predV = hod;
      }
      if (protnuto) {
        r.push(nejdal);
      } else if (!platnych) {
        // bez jediného vzorku: buď je silnice blíž než nejnižší kruh, nebo tudy žádná nevede
        if (nejnizsi <= zaklad * 0.1) {
          r.push(0);
        } else {
          r.push(zaklad);
          odhadu++;
          prazdne++;
        }
      } else if (posledni) {
        r.push(Math.min(1600, (predR * limit) / predV));
        odhadu++;
      } else {
        r.push(nejdal); // dál už žádná silnice (moře, hranice dat)
      }
    }
    return { r, odhadu, prazdne, zaklad };
  }

  // Které poloměry ještě chybí, aby hranice ležela mezi skutečnými vzorky.
  planHranice(limit, jednotka) {
    const { r, odhadu, prazdne, zaklad } = this.hranice(limit, jednotka);
    const kladne = r.filter((x) => x > 0);
    if (!kladne.length) return [];
    const m = median(kladne);
    const do_ = Math.min(1600, (odhadu ? Math.max(...kladne) : m) * 1.3);
    let od = Math.min(m * 0.5, Math.min(...kladne) * 0.8);
    if (prazdne) od = Math.min(od, POLOMERY[this.razeneKruhy()[0]] * 0.5 || od);
    od = Math.max(od, zaklad * 0.08);
    const chybi = [];
    POLOMERY.forEach((p, i) => {
      if (p >= od && p <= do_ && !this.kruhy.has(i)) chybi.push(i);
    });
    return chybi.length ? this.doplnDavku(chybi, m) : [];
  }

  // Na šířku se platí za dotaz, ne za bod: další kruhy kolem se vezmou rovnou, ať posuvník nečeká.
  doplnDavku(chybi, m) {
    const vzdal = (i) => Math.abs(Math.log(POLOMERY[i] / m));
    const volne = POLOMERY.map((_, i) => i)
      .filter((i) => !this.kruhy.has(i) && !chybi.includes(i))
      .sort((a, b) => vzdal(a) - vzdal(b));
    const kolik = Math.floor(POCET_NA_DOTAZ / this.paprsku);
    return [...chybi.sort((a, b) => vzdal(a) - vzdal(b)), ...volne].slice(0, kolik);
  }

  planPolomeru(km) {
    const i = POLOMERY.findIndex((p) => p >= km);
    const horni = i < 0 ? POLOMERY.length - 1 : i;
    const chybi = [horni - 1, horni].filter((x) => x >= 0 && !this.kruhy.has(x));
    return chybi.length ? this.doplnDavku(chybi, km) : [];
  }

  async nacti(indexy, platne = () => true) {
    const m = ZPUSOBY[this.zpusob];
    const body = [];
    for (const i of indexy) {
      for (let p = 0; p < this.paprsku; p++) {
        body.push({ i, p, ...bodNaPaprsku(this.lat, this.lon, (p * 360) / this.paprsku, POLOMERY[i]) });
      }
    }
    for (let k = 0; k < body.length; k += POCET_NA_DOTAZ) {
      const cast = body.slice(k, k + POCET_NA_DOTAZ);
      const vysledek = await veFronte(() => (platne() ? this.stahni(m.sluzba, this, cast) : null));
      if (!vysledek) return false;
      cast.forEach((b, x) => {
        if (!this.kruhy.has(b.i)) this.kruhy.set(b.i, new Array(this.paprsku).fill(null));
        this.kruhy.get(b.i)[b.p] = this.platny(vysledek[x], POLOMERY[b.i]);
      });
    }
    this.chyba = false;
    return true;
  }

  // Čas a délka cesty na daný poloměr v jednom paprsku (mezi dvěma vzorky přímkou).
  naPolomeru(p, km) {
    let predR = 0;
    let pred = { t: 0, d: 0 };
    for (const i of this.razeneKruhy()) {
      const v = this.kruhy.get(i)[p];
      if (!v) continue;
      const rv = POLOMERY[i];
      if (rv >= km) {
        const x = (km - predR) / (rv - predR);
        return { t: pred.t + x * (v.t - pred.t), d: pred.d + x * (v.d - pred.d) };
      }
      predR = rv;
      pred = v;
    }
    return null;
  }

  // Souhrn přes směry: `km` je poloměr, nebo pole poloměrů po paprscích.
  souhrn(km) {
    const t = [];
    const d = [];
    for (let p = 0; p < this.paprsku; p++) {
      const v = this.naPolomeru(p, Array.isArray(km) ? km[p] : km);
      if (v) {
        t.push(v.t);
        d.push(v.d);
      }
    }
    if (t.length < Math.max(3, this.paprsku * 0.3)) return null;
    return {
      t: median(t),
      d: median(d),
      tOd: percentil(t, 0.1),
      tDo: percentil(t, 0.9),
    };
  }
}

export function casText(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    return `${h} h ${String(m % 60).padStart(2, '0')}`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.round((m - d * 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

export function kmText(km) {
  if (km < 10) return `${String(Math.round(km * 10) / 10).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function hodnotaText(hodnota, jednotka) {
  return jednotka === 'min' ? casText(hodnota) : kmText(hodnota);
}

// Poloha posuvníku <-> hodnota: nakonec řady je potřeba jemnost i rozsah zároveň.
const MAXIMA = { km: 1000, min: 600 };
export function zPosuvniku(p, jednotka) {
  const v = Math.exp(p * Math.log(MAXIMA[jednotka]));
  if (v < 10) return Math.max(1, Math.round(v));
  if (v < 200) return Math.round(v);
  if (v < 500) return Math.round(v / 5) * 5;
  return Math.round(v / 10) * 10;
}
export function naPosuvnik(v, jednotka) {
  return Math.min(1, Math.max(0, Math.log(Math.max(1, v)) / Math.log(MAXIMA[jednotka])));
}
