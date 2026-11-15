// Vlastní malá mapa: dlaždice OSM na plátně, posun, dva prsty, kolečko, dvojklep, přelet.
// Nad dlaždicemi je druhé plátno pro okruhy, ať tmavý filtr dlaždic nemění jejich barvy.

const VELIKOST = 256;
const Z_MIN = 2;
const Z_MAX = 19;

export const naX = (lon) => (lon + 180) / 360;
export function naY(lat) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
const zX = (x) => x * 360 - 180;
const zY = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export class Mapa {
  constructor(el, { dlazdice, vrstva, volby }) {
    Object.assign(this, { el, dlazdice, vrstva });
    this.volby = volby; // kresli(ctx), uchop(x, y), tah(lat, lon), pust(posunuto), klep(lat, lon, x, y)
    this.cx = naX(15.4);
    this.cy = naY(49.8);
    this.z = 7;
    this.obrazky = new Map();
    this.prsty = new Map();
    this.w = 0;
    this.h = 0;
    new ResizeObserver(() => this.rozmer()).observe(el);
    this.rozmer();
    this.navazat();
  }

  rozmer() {
    const box = this.el.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = box.width;
    this.h = box.height;
    for (const c of [this.dlazdice, this.vrstva]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.prekresli();
  }

  get svet() {
    return VELIKOST * 2 ** this.z;
  }

  bod(lat, lon) {
    return { x: (naX(lon) - this.cx) * this.svet + this.w / 2, y: (naY(lat) - this.cy) * this.svet + this.h / 2 };
  }

  souradnice(x, y) {
    return { lat: zY(this.cy + (y - this.h / 2) / this.svet), lon: zX(this.cx + (x - this.w / 2) / this.svet) };
  }

  prekresli() {
    if (this.ceka) return;
    this.ceka = requestAnimationFrame(() => {
      this.ceka = 0;
      this.kresliDlazdice();
      const ctx = this.vrstva.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      this.volby.kresli(ctx);
    });
  }

  obrazek(z, x, y) {
    const klic = `${z}/${x}/${y}`;
    let o = this.obrazky.get(klic);
    if (o) {
      this.obrazky.delete(klic);
      this.obrazky.set(klic, o); // naposledy použité na konec
      return o;
    }
    o = new Image();
    o.referrerPolicy = 'strict-origin-when-cross-origin';
    o.onload = () => {
      o.hotovo = true;
      this.prekresli();
    };
    o.src = `https://tile.openstreetmap.org/${klic}.png`;
    this.obrazky.set(klic, o);
    if (this.obrazky.size > 500) {
      const nejstarsi = this.obrazky.keys().next().value;
      this.obrazky.delete(nejstarsi);
    }
    return o;
  }

  // Dokud dlaždice není, kreslí se výřez z větší nadřazené, ať mapa při přiblížení nebliká.
  nahrada(z, x, y) {
    for (let up = 1; up <= 5 && z - up >= 0; up++) {
      const m = 2 ** up;
      const o = this.obrazky.get(`${z - up}/${Math.floor(x / m)}/${Math.floor(y / m)}`);
      if (o?.hotovo) {
        const s = VELIKOST / m;
        return { o, sx: (x % m) * s, sy: (y % m) * s, s };
      }
    }
    return null;
  }

  kresliDlazdice() {
    const ctx = this.dlazdice.getContext('2d');
    const { dpr, w, h } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // na jemném displeji o půl stupně víc, jinak je 256px dlaždice rozmazaná
    const tz = Math.max(0, Math.min(19, Math.round(this.z + (dpr >= 1.5 ? 0.45 : 0))));
    const pocet = 2 ** tz;
    const vel = (VELIKOST * 2 ** this.z) / pocet;
    const x0 = this.cx * pocet - w / 2 / vel;
    const y0 = this.cy * pocet - h / 2 / vel;
    for (let ty = Math.floor(y0); ty < y0 + h / vel; ty++) {
      if (ty < 0 || ty >= pocet) continue;
      for (let tx = Math.floor(x0); tx < x0 + w / vel; tx++) {
        const px = Math.floor((tx - x0) * vel * dpr) / dpr;
        const py = Math.floor((ty - y0) * vel * dpr) / dpr;
        const s = vel + 1 / dpr;
        const xx = ((tx % pocet) + pocet) % pocet;
        const o = this.obrazek(tz, xx, ty);
        if (o.hotovo) {
          ctx.drawImage(o, px, py, s, s);
        } else {
          const n = this.nahrada(tz, xx, ty);
          if (n) ctx.drawImage(n.o, n.sx, n.sy, n.s, n.s, px, py, s, s);
        }
      }
    }
  }

  posun(dx, dy) {
    this.cx += dx / this.svet;
    this.cy = Math.max(0, Math.min(1, this.cy + dy / this.svet));
    this.prekresli();
  }

  zoomKolem(z, x, y) {
    const novy = Math.max(Z_MIN, Math.min(Z_MAX, z));
    const pred = this.svet;
    const mx = this.cx + (x - this.w / 2) / pred;
    const my = this.cy + (y - this.h / 2) / pred;
    this.z = novy;
    this.cx = mx - (x - this.w / 2) / this.svet;
    this.cy = Math.max(0, Math.min(1, my - (y - this.h / 2) / this.svet));
    this.prekresli();
  }

  zastav() {
    cancelAnimationFrame(this.animace);
    this.animace = 0;
  }

  prelet(cx, cy, z) {
    this.zastav();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      Object.assign(this, { cx, cy, z });
      this.prekresli();
      return;
    }
    const start = performance.now();
    const [a, b, c] = [this.cx, this.cy, this.z];
    const krok = (t) => {
      const u = Math.min(1, (t - start) / 480);
      const e = 1 - (1 - u) ** 3;
      this.cx = a + (cx - a) * e;
      this.cy = b + (cy - b) * e;
      this.z = c + (z - c) * e;
      this.prekresli();
      this.animace = u < 1 ? requestAnimationFrame(krok) : 0;
    };
    this.animace = requestAnimationFrame(krok);
  }

  // Ukáže body tak, aby se vešly do volné části mapy (okraje = panel a lišty).
  ukaz(body, okraje = {}) {
    if (!body.length) return;
    const { l = 24, t = 24, r = 24, b = 24 } = okraje;
    const xs = body.map((p) => naX(p.lon));
    const ys = body.map((p) => naY(p.lat));
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const volnoW = Math.max(60, this.w - l - r);
    const volnoH = Math.max(60, this.h - t - b);
    const z = Math.max(Z_MIN, Math.min(16, Math.log2(Math.min(volnoW / Math.max(x2 - x1, 1e-9), volnoH / Math.max(y2 - y1, 1e-9)) / VELIKOST)));
    const svet = VELIKOST * 2 ** z;
    this.prelet((x1 + x2) / 2 + ((r - l) / 2) / svet, (y1 + y2) / 2 + ((b - t) / 2) / svet, z);
  }

  navazat() {
    const v = this.vrstva;
    v.addEventListener('pointerdown', (e) => this.dolu(e));
    v.addEventListener('pointermove', (e) => this.pohyb(e));
    v.addEventListener('pointerup', (e) => this.nahoru(e));
    v.addEventListener('pointercancel', (e) => this.nahoru(e, true));
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zastav();
      const b = v.getBoundingClientRect();
      this.zoomKolem(this.z - e.deltaY * (e.ctrlKey ? 0.01 : 0.0022), e.clientX - b.left, e.clientY - b.top);
    }, { passive: false });
  }

  relativne(e) {
    const b = this.vrstva.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  dolu(e) {
    this.vrstva.setPointerCapture(e.pointerId);
    this.zastav();
    const p = this.relativne(e);
    this.prsty.set(e.pointerId, p);
    if (this.prsty.size === 1) {
      this.rezim = this.volby.uchop(p.x, p.y) ? 'spendlik' : 'posun';
      Object.assign(this, { start: p, posunuto: false, startCas: performance.now(), rychlost: { x: 0, y: 0 }, minule: performance.now() });
    } else if (this.prsty.size === 2) {
      this.rezim = 'prsty';
      this.posunuto = true;
      this.predRozpeti = null;
    }
  }

  pohyb(e) {
    if (!this.prsty.has(e.pointerId)) return;
    const pred = this.prsty.get(e.pointerId);
    const p = this.relativne(e);
    this.prsty.set(e.pointerId, p);
    if (this.prsty.size === 2) {
      const [a, b] = [...this.prsty.values()];
      const rozpeti = Math.hypot(a.x - b.x, a.y - b.y);
      const stred = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.predRozpeti) {
        this.posun(this.predStred.x - stred.x, this.predStred.y - stred.y);
        this.zoomKolem(this.z + Math.log2(rozpeti / this.predRozpeti), stred.x, stred.y);
      }
      this.predRozpeti = rozpeti;
      this.predStred = stred;
      return;
    }
    if (!this.posunuto && Math.hypot(p.x - this.start.x, p.y - this.start.y) < 7) return;
    this.posunuto = true;
    if (this.rezim === 'spendlik') {
      const g = this.souradnice(p.x, p.y);
      this.volby.tah(g.lat, g.lon);
    } else if (this.rezim === 'posun') {
      const ted = performance.now();
      const dt = Math.max(1, ted - this.minule);
      this.rychlost = { x: (pred.x - p.x) / dt, y: (pred.y - p.y) / dt };
      this.minule = ted;
      this.posun(pred.x - p.x, pred.y - p.y);
    }
  }

  nahoru(e, zruseno) {
    if (!this.prsty.has(e.pointerId)) return;
    const p = this.prsty.get(e.pointerId);
    this.prsty.delete(e.pointerId);
    if (this.prsty.size === 1) {
      this.rezim = 'posun';
      this.minule = performance.now();
      return;
    }
    if (this.prsty.size) return;
    if (this.rezim === 'spendlik') {
      this.volby.pust(this.posunuto);
    } else if (this.rezim === 'posun' && !zruseno) {
      if (this.posunuto) this.setrvacnost();
      else this.klepnuti(p);
    }
    this.rezim = null;
  }

  setrvacnost() {
    if (performance.now() - this.minule > 60) return;
    let { x, y } = this.rychlost;
    let minule = performance.now();
    const krok = (t) => {
      const dt = t - minule;
      minule = t;
      const utlum = 0.996 ** dt;
      x *= utlum;
      y *= utlum;
      this.posun(x * dt, y * dt);
      this.animace = Math.hypot(x, y) > 0.02 ? requestAnimationFrame(krok) : 0;
    };
    this.animace = requestAnimationFrame(krok);
  }

  // Jedno klepnutí se ohlásí až po čekání na případné druhé (dvojklep přibližuje).
  klepnuti(p) {
    const ted = performance.now();
    if (this.minuleKlep && ted - this.minuleKlep.cas < 280 && Math.hypot(p.x - this.minuleKlep.x, p.y - this.minuleKlep.y) < 30) {
      clearTimeout(this.cekaKlep);
      this.minuleKlep = null;
      const c = this.z + 1;
      const a = this.z;
      const start = ted;
      const krok = (t) => {
        const u = Math.min(1, (t - start) / 240);
        this.zoomKolem(a + (c - a) * (1 - (1 - u) ** 3), p.x, p.y);
        this.animace = u < 1 ? requestAnimationFrame(krok) : 0;
      };
      this.animace = requestAnimationFrame(krok);
      return;
    }
    this.minuleKlep = { ...p, cas: ted };
    clearTimeout(this.cekaKlep);
    this.cekaKlep = setTimeout(() => {
      const g = this.souradnice(p.x, p.y);
      this.volby.klep(g.lat, g.lon);
    }, 240);
  }
}
