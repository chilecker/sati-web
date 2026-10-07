// Actualiza los datos de clima.html con la corrida GFS más reciente publicada por earth.nullschool.net.
// Uso: node scripts/actualizar-clima.mjs [ruta/a/clima.html]
// Requiere Node 18+ (fetch nativo). Sin dependencias.
import { readFile, writeFile } from "node:fs/promises";

const FILE = process.argv[2] || "clima.html";
const BASE = "https://gaia.nullschool.net/data/gfs";
const H3 = 3 * 3600e3, STEPS = 25;
const GRID = { lon0: -78, lat0: -24, nx: 15, ny: 23 }; // grilla 1°, j=0 en -24°
const POINT = { lat: -33.5, lon: -70.5 };              // celda 0.5° más cercana a Providencia
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES3 = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// ---- decodificador epak (formato de earth.nullschool.net) ----
function unpack(e, t) {
  let r = 0, n = 0;
  while (r < t.length) {
    let o = t[r++];
    if (o < 128) o = (o << 25) >> 25;
    else switch (o >> 4) {
      case 8: case 9: case 10: case 11: o = ((o << 26) >> 18) | t[r++]; break;
      case 12: case 13: o = ((o << 27) >> 11) | (t[r++] << 8) | t[r++]; break;
      case 14: o = ((o << 28) >> 4) | (t[r++] << 16) | (t[r++] << 8) | t[r++]; break;
      case 15:
        if (o === 255) { for (let i = 1 + t[r++]; i > 0; i--) e[n++] = NaN; continue; }
        o = (t[r++] << 24) | (t[r++] << 16) | (t[r++] << 8) | t[r++]; break;
    }
    e[n++] = o;
  }
  return e;
}
function undelta(e, t, r, n) {
  for (let a = 0; a < n; a++) {
    const u = a * t * r;
    for (let o = 1; o < t; o++) { const s = u + o, l = e[s - 1]; e[s] += l === l ? l : 0; }
    for (let i = 1; i < r; i++) {
      const c = u + i * t; let l = e[c - t]; e[c] += l === l ? l : 0;
      for (let o = 1; o < t; o++) {
        const s = c + o, f = e[s - 1], p = e[s - t], m = e[s - t - 1];
        l = f + p - m; e[s] += l === l ? l : f === f ? f : p === p ? p : m === m ? m : 0;
      }
    }
  }
  return e;
}
async function epak(url) {
  let res;
  for (let intento = 1; intento <= 3; intento++) {
    res = await fetch(url, { headers: { "User-Agent": "SATI-Clima/1.0 (+https://chilecker.github.io/sati-web/clima.html)" } });
    if (res.ok || res.status === 404) break;
    await new Promise(r => setTimeout(r, 3000 * intento));
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = await res.arrayBuffer(), dv = new DataView(buf), td = new TextDecoder();
  let n = 8 + dv.getInt32(4);
  const head = JSON.parse(td.decode(new Uint8Array(buf, 8, n - 8)));
  const blocks = [];
  while (n + 8 <= buf.byteLength) {
    if (td.decode(new Uint8Array(buf, n, 4)) === "tail") break;
    const len = dv.getInt32(n + 4); n += 8;
    const d = new DataView(buf, n, len);
    const cols = d.getInt32(0), rows = d.getInt32(4), grids = d.getInt32(8), sc = Math.pow(10, d.getFloat32(12));
    const arr = new Float32Array(cols * rows * grids);
    unpack(arr, new Uint8Array(buf, n + 16, len - 16));
    undelta(arr, cols, rows, grids);
    for (let i = 0; i < arr.length; i++) arr[i] /= sc;
    blocks.push({ cols, arr });
    n += len;
  }
  return { head, blocks };
}

// ---- descarga ----
const pad = n => String(n).padStart(2, "0");
const url = (d, f) => `${BASE}/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCHours())}00-${f}-gfs-0.5.epak`;
const FIELDS = ["wind-surface-level", "temp-surface-level", "precip_3hr", "relative_humidity-surface-level", "mean_sea_level_pressure", "total_cloud_water"];
const idx = (b, lat, lon) => Math.round((90 - lat) / 0.5) * b.cols + Math.round(((lon + 360) % 360) / 0.5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;

const t0 = Math.floor(Date.now() / H3) * H3;
const PLANE = GRID.nx * GRID.ny;
const raw = new Uint8Array(STEPS * 4 * PLANE);
const PT = [], RH = [], MS = [], CW = [];
let init = null;

for (let s = 0; s < STEPS; s++) {
  const d = new Date(t0 + s * H3);
  const [w, t, p, rh, ms, cw] = await Promise.all(FIELDS.map(f => epak(url(d, f))));
  init ??= w.head.variables.time["init-time"];
  for (let j = 0; j < GRID.ny; j++) for (let i = 0; i < GRID.nx; i++) {
    const k = idx(w.blocks[0], GRID.lat0 - j, GRID.lon0 + i);
    const vals = [
      clamp(Math.round(w.blocks[0].arr[k] * 4), -127, 127) & 255,
      clamp(Math.round(w.blocks[1].arr[k] * 4), -127, 127) & 255,
      clamp(Math.round((t.blocks[0].arr[k] - 273.15) * 2), -127, 127) & 255,
      clamp(Math.round(Math.sqrt(Math.max(0, p.blocks[0].arr[k] || 0)) * 20), 0, 255),
    ];
    for (let v = 0; v < 4; v++) raw[(s * 4 + v) * PLANE + j * GRID.nx + i] = vals[v];
  }
  const kp = idx(w.blocks[0], POINT.lat, POINT.lon);
  PT.push([Math.round(w.blocks[0].arr[kp] * 4) / 4, Math.round(w.blocks[1].arr[kp] * 4) / 4,
           Math.round((t.blocks[0].arr[kp] - 273.15) * 2) / 2, r1(p.blocks[0].arr[kp] || 0)]);
  RH.push(Math.round(rh.blocks[0].arr[kp]));
  MS.push(r1(ms.blocks[0].arr[kp] / 100));
  CW.push(r2(cw.blocks[0].arr[kp]));
  console.log(`paso ${s + 1}/${STEPS} ${d.toISOString().slice(0, 13)}Z ok`);
}

// ---- reemplazo en clima.html (solo datos) ----
const d0 = new Date(t0), di = new Date(Date.parse(init) - 3 * 3600e3); // hora Chile aproximada (UTC-3)
let html = await readFile(FILE, "utf8");
const rep = (re, val) => { if (!re.test(html)) throw new Error("No se encontró " + re); html = html.replace(re, () => val); };
rep(/const RAW="[A-Za-z0-9+/=]*";/, `const RAW="${Buffer.from(raw).toString("base64")}";`);
rep(/init:"[^"]*",t0:Date\.UTC\([^)]*\)/, `init:"${init}",t0:Date.UTC(${d0.getUTCFullYear()},${d0.getUTCMonth()},${d0.getUTCDate()},${d0.getUTCHours()})`);
rep(/const PT=\[\[.*?\]\];/, `const PT=${JSON.stringify(PT)};`);
rep(/const RH=\[[^\]]*\];/, `const RH=${JSON.stringify(RH)};`);
rep(/const MS=\[[^\]]*\];/, `const MS=${JSON.stringify(MS)};`);
rep(/const CW=\[[^\]]*\];/, `const CW=${JSON.stringify(CW)};`);
rep(/runlbl"\)\.textContent="[^"]*"/, `runlbl").textContent="${pad(di.getUTCDate())}-${MES3[di.getUTCMonth()]} ${pad(di.getUTCHours())}:00 (hora Chile)"`);
rep(/corrida del \d+ de [a-záéíóú]+/, `corrida del ${di.getUTCDate()} de ${MESES[di.getUTCMonth()]}`);
await writeFile(FILE, html);
const lluvia24 = PT.slice(1, 9).reduce((a, r) => a + r[3], 0);
console.log(`Listo: corrida ${init}, desde ${d0.toISOString().slice(0, 13)}Z. Lluvia prevista en Providencia (24 h): ${lluvia24.toFixed(1)} mm`);
