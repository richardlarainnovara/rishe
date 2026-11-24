/* Lee el catálogo público de la tienda de Squarespace y lo entrega limpio a la página.
   Netlify guarda la respuesta 30 min, así que la tienda no recibe una consulta por cada visita.
   La lista de Squarespace trae la foto sin nombre de archivo, así que la foto real se toma
   de la ficha de cada producto (su imagen para compartir) y se recuerda mientras la función esté activa. */
const SITIO = "https://www.tapetesrishe.mx";
const TIENDA = SITIO + "/tienda";
const UA = { "User-Agent": "Mozilla/5.0 (catalogo)" };
const memoFoto = new Map();

const limpiar = html => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function grupo(t){
  t = t.toLowerCase();
  if (/rúst|rust|patch|kilim/.test(t)) return "rustico";
  if (/vintage/.test(t)) return "vintage";
  if (/modern|shag|paradise/.test(t)) return "moderno";
  return "clasico";
}

function medida(txt){
  const m = txt.match(/(\d+(?:[.,]\d+)?)\s*(?:m|cm)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(cm|m)?/i);
  if (!m) return "";
  const u = (m[3] || (parseFloat(m[1]) > 10 ? "cm" : "m")).toLowerCase();
  return m[1].replace(",", ".") + " × " + m[2].replace(",", ".") + " " + u;
}

function material(txt){
  const t = txt.toLowerCase(), out = [];
  if (/bamb[uú]/.test(t)) return { es: "Fibra de bambú", en: "Bamboo fiber" };
  if (/lana/.test(t)) out.push("lana");
  if (/seda/.test(t)) out.push("seda");
  if (out.length === 2) return { es: "Lana y seda", en: "Wool and silk" };
  if (out[0] === "lana") return { es: "Lana", en: "Wool" };
  if (/sint[eé]tic/.test(t)) return { es: "Sintético", en: "Synthetic" };
  return null;
}

function precio(v){
  if (!v) return null;
  if (v.priceMoney && v.priceMoney.value) return parseFloat(v.priceMoney.value);
  if (typeof v.price === "number") return v.price / 100;
  return null;
}

function convertir(it){
  const sc = it.structuredContent || {};
  const vars = sc.variants || it.variants || [];
  const v = vars[0];
  let p = precio(v), antes = null;
  if (v && v.onSale){
    const s = v.salePriceMoney && v.salePriceMoney.value ? parseFloat(v.salePriceMoney.value)
            : typeof v.salePrice === "number" ? v.salePrice / 100 : null;
    if (s && p && s < p){ antes = p; p = s; }
  }
  const hayStock = !vars.length || vars.some(x => x.unlimited || (x.stock && x.stock.unlimited) ||
                    (x.qtyInStock != null ? x.qtyInStock : (x.stock && x.stock.quantity) || 0) > 0);
  const texto = limpiar((it.excerpt || "") + " " + (it.body || "")).slice(0, 1500);
  const titulo = String(it.title || "").trim();
  const base = String(it.assetUrl || "");
  const alterna = it.items && it.items[0] && it.items[0].assetUrl ? String(it.items[0].assetUrl) : "";
  return {
    n: titulo,
    g: grupo(titulo),
    p: p ? Math.round(p) : null,
    antes: antes ? Math.round(antes) : undefined,
    mano: /a mano|handmade|anudado/i.test(titulo + " " + texto) && !/m[aá]quina/i.test(titulo + " " + texto),
    med: medida(titulo + " " + texto),
    mat: material(titulo + " " + texto) || undefined,
    i: (base.endsWith("/") && alterna ? alterna : base).replace(/^http:/, "https:"),
    u: it.fullUrl || "",
    agotado: !hayStock
  };
}

/* La imagen para compartir de la ficha del producto trae la dirección completa de la foto. */
async function fotoDe(u){
  if (memoFoto.has(u)) return memoFoto.get(u);
  const ctl = new AbortController(), reloj = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(u.startsWith("http") ? u : SITIO + u, { headers: UA, signal: ctl.signal });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (!m) return null;
    const url = m[1].replace(/&amp;/g, "&").split("?")[0].replace(/^http:/, "https:");
    if (!/\/[^\/]+\.(?:jpe?g|png|gif|webp)$/i.test(url) || /logo|fondo/i.test(url)) return null;
    memoFoto.set(u, url);
    return url;
  } catch (e){
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

async function enParalelo(lista, n, fn){
  let k = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (k < lista.length){ const x = lista[k++]; await fn(x); }
  }));
}

export default async () => {
  try {
    let url = TIENDA + "?format=json", items = [], vueltas = 0;
    while (url && vueltas < 15){
      const r = await fetch(url, { headers: UA });
      if (!r.ok) break;
      const j = await r.json();
      items = items.concat(j.items || []);
      const pg = j.pagination;
      url = pg && pg.nextPage && pg.nextPageOffset != null ? TIENDA + "?format=json&offset=" + pg.nextPageOffset : null;
      vueltas++;
    }
    const productos = items.map(convertir).filter(x => x.n && x.p && x.i && x.u);
    if (!productos.length) throw new Error("catálogo vacío");

    const limite = Date.now() + 8000;
    await enParalelo(productos, 10, async p => {
      if (Date.now() > limite) return;
      const foto = await fotoDe(p.u);
      if (foto) p.i = foto;
    });

    return new Response(JSON.stringify({ actualizado: new Date().toISOString(), total: productos.length, productos }), {
      headers: { "content-type": "application/json; charset=utf-8",
                 "cache-control": "public, max-age=300",
                 "netlify-cdn-cache-control": "public, s-maxage=1800, stale-while-revalidate=86400" }
    });
  } catch (e){
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { "content-type": "application/json" } });
  }
};

export const config = { path: "/api/catalogo" };
