// AZOBSS Render Backend Server
// Supports: website hosting + affiliate online sync + JUPEM PA hold system

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

const sharp = require("sharp");
const PDFDocument = require("pdfkit");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();

const AFFILIATE_JSON = path.join(ROOT, "affiliate-products.json");
const TEMP_DIR = path.join(ROOT, "temp");
const DOWNLOAD_TOKENS = new Map();

// AUTO DELETE FILE > 30 DAYS
const FILE_EXPIRE_MS =
  30 * 24 * 60 * 60 * 1000;
  
function send(res, status, body, type = "text/plain; charset=utf-8") {

  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  res.end(body);
}

function readBody(req) {

  return new Promise((resolve, reject) => {

    let body = "";

    req.on("data", chunk => {

      body += chunk.toString();

      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }

    });

    req.on("end", () => resolve(body));
    req.on("error", reject);

  });
}

function mimeType(filePath) {

  const ext = path.extname(filePath).toLowerCase();

  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf"
  };

  return types[ext] || "application/octet-stream";
}

function safePath(requestPath) {

  let cleanPath =
    decodeURIComponent(requestPath.split("?")[0]);

  if (cleanPath === "/") {
    cleanPath = "/index.html";
  }

  const resolved =
    path.normalize(path.join(ROOT, cleanPath));

  if (!resolved.startsWith(ROOT)) {
    return null;
  }

  return resolved;
}

function cleanPA(noPA) {

  let v = String(noPA || "")
    .trim()
    .toUpperCase();

  v = v.replace(/\.TIF$/i, "");
  v = v.replace(/[^A-Z0-9_-]/g, "");

  return v;
}

function cleanState(negeri) {

  let v = String(negeri || "")
    .trim()
    .toUpperCase();

  v = v.replace(/[^A-Z0-9 _-]/g, "");

  return v;
}



function cleanBenchmarkProduct(value) {
  const v = String(value || '').trim().toUpperCase();
  return v === 'SBM' ? 'SBM' : 'BM';
}

function cleanSearch(value) {
  return String(value || '')
    .trim()
    .replace(/[<>]/g, '')
    .slice(0, 120);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutizeJupemUrl(rawUrl) {
  if (!rawUrl) return '';
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith('/')) return 'https://ebiz.jupem.gov.my' + rawUrl;
  return 'https://ebiz.jupem.gov.my/' + rawUrl.replace(/^\/+/, '');
}

function parseBenchmarkRows(html, produkFallback, negeriFallback) {
  const rows = [];
  const tableRowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = tableRowPattern.exec(html))) {
    const rowHtml = rowMatch[1];
    const cellMatches = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cellMatches.length < 5) continue;
    const cells = cellMatches.map(item => stripHtml(item[1]));
    const joined = cells.join(' ').toLowerCase();
    if (joined.includes('no. stesen') || joined.includes('tambah ke troli')) continue;

    const linkMatch = rowHtml.match(/href=["']([^"']*(?:Lokasi|Peta|Map|Koordinat|location)[^"']*)["']/i) || rowHtml.match(/href=["']([^"']*)["']/i);
    const stationNo = cells[1] || cells[0] || '';
    if (!stationNo || /^no\.?$/i.test(stationNo)) continue;

    rows.push({
      product: produkFallback,
      stationNo,
      negeri: cells[2] || negeriFallback,
      daerah: cells[3] || '',
      bandar: cells[4] || '',
      huraian: cells[5] || '',
      harga: cells[6] || '',
      locationUrl: linkMatch ? absolutizeJupemUrl(linkMatch[1]) : '',
      raw: cells
    });
  }
  return rows.slice(0, 60);
}

async function fetchJupem(jupemUrl) {
  return await fetch(jupemUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "image/tiff,image/*,*/*",
      "Referer": "https://ebiz.jupem.gov.my/"
    }
  });
}



function normalizeAffiliateUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return 'https://' + value;
  return value;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return decodeHtmlEntities(match[1]);
  }
  return '';
}

function pickTitleFromHtml(html) {
  return decodeHtmlEntities(
    pickMeta(html, 'og:title') ||
    pickMeta(html, 'twitter:title') ||
    ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')
  ).replace(/\s*\|\s*Shopee.*$/i, '').replace(/\s*-\s*Shopee.*$/i, '').trim();
}

function shortenDescription(text, fallbackTitle) {
  const clean = decodeHtmlEntities(text || '').replace(/\s+/g, ' ').trim();
  if (clean && !/^Shopee/i.test(clean)) return clean.slice(0, 260);
  return `${fallbackTitle || 'Produk ini'} sesuai untuk kegunaan harian. Semak detail produk di Shopee sebelum membeli.`;
}

function titleToIcon(title) {
  const t = String(title || '').toLowerCase();
  if (/ssd|nvme|hard disk|hdd|ram|router|wifi|pc|laptop|keyboard|mouse|monitor|usb|type-c|charger/.test(t)) return /ssd|nvme/.test(t) ? 'SSD' : 'PC';
  if (/vacuum|mop|clean|penyapu|habuk/.test(t)) return '🧹';
  if (/car|kereta|dashcam|tyre|tayar|automotive|motor/.test(t)) return '🚗';
  if (/camera|drone|cctv|webcam/.test(t)) return 'CAM';
  if (/bag|wallet|beg/.test(t)) return '👜';
  if (/shoe|kasut|sandal/.test(t)) return '👟';
  if (/baju|shirt|dress|clothes|tudung|hijab/.test(t)) return '👕';
  if (/watch|jam tangan/.test(t)) return '⌚';
  if (/baby|toy|mainan/.test(t)) return '🧸';
  if (/food|coklat|chocolate|snack|kopi|coffee|grocery/.test(t)) return '🍫';
  if (/sport|outdoor|camp|gym/.test(t)) return '🏕️';
  if (/book|game|hobby/.test(t)) return '🎮';
  return '🛒';
}

function titleToCategory(title) {
  const t = String(title || '').toLowerCase();
  if (/ssd|nvme|hard disk|hdd|ram|router|wifi|pc|laptop|keyboard|mouse|monitor|usb|type-c|charger|printer/.test(t)) return 'computer';
  if (/phone|iphone|android|case|screen protector|powerbank/.test(t)) return 'mobile';
  if (/vacuum|mop|organizer|rack|lamp|sofa|home|rumah|clean/.test(t)) return 'home-living';
  if (/air fryer|blender|kettle|rice cooker|appliance/.test(t)) return 'home-appliances';
  if (/car|kereta|dashcam|tyre|tayar|automotive|motor/.test(t)) return 'automotive';
  if (/camera|drone|cctv|webcam/.test(t)) return 'camera';
  if (/watch|jam tangan/.test(t)) return 'watches';
  if (/bag|handbag|tote|purse/.test(t)) return 'womens-bags';
  if (/wallet|men bag|sling bag/.test(t)) return 'mens-bags';
  if (/dress|women clothes|baju perempuan/.test(t)) return 'women-clothes';
  if (/shirt|tshirt|men clothes|baju lelaki/.test(t)) return 'men-clothes';
  if (/shoe|kasut|sneaker|sandal/.test(t)) return 'men-shoes';
  if (/tudung|hijab|muslim/.test(t)) return 'muslim';
  if (/beauty|skin|makeup|health|serum/.test(t)) return 'health';
  if (/baby|toy|mainan/.test(t)) return 'baby';
  if (/food|coklat|chocolate|snack|kopi|coffee|grocery|pet/.test(t)) return 'groceries';
  if (/sport|outdoor|camp|gym/.test(t)) return 'sports';
  if (/game|console|controller/.test(t)) return 'gaming';
  if (/book|hobby/.test(t)) return 'books';
  if (/travel|luggage|bagasi/.test(t)) return 'travel';
  return 'others';
}

function titleToBadge(title, category) {
  const t = String(title || '').toLowerCase();
  if (/ssd|nvme|storage/.test(t)) return 'Fast Storage';
  if (/router|wifi|5g/.test(t)) return 'Networking';
  if (/vacuum|mop|clean/.test(t)) return 'Cleaning Gadget';
  if (/car|kereta|dashcam/.test(t)) return 'Car Gadget';
  if (/chocolate|coklat|snack/.test(t)) return 'Chocolate';
  if (category === 'computer') return 'Computer & Accessories';
  if (category === 'home-living') return 'Home Useful Item';
  return 'Useful Item';
}

function titleToMeta(title, category) {
  const t = String(title || '').toLowerCase();
  if (/ssd|nvme/.test(t)) return 'Best for Windows and game loading';
  if (/router|wifi/.test(t)) return 'Best for stronger home internet setup';
  if (/vacuum|mop|clean/.test(t)) return 'Best for car and home cleaning';
  if (/car|kereta|dashcam/.test(t)) return 'Best for daily car use';
  if (/chocolate|coklat|snack/.test(t)) return 'Best for snack and gift idea';
  if (category === 'computer') return 'Best for PC setup and daily use';
  return 'Best for useful daily item';
}

function cleanShopeeTitle(title) {
  return decodeHtmlEntities(String(title || ''))
    .replace(/^Shopee\s+/i, '')
    .replace(/\s*\|\s*Shopee.*$/i, '')
    .replace(/\s*-\s*Shopee.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function detectAffiliateProduct(rawUrl) {
  const targetUrl = normalizeAffiliateUrl(rawUrl);
  if (!targetUrl) throw new Error('Missing URL');

  const response = await fetch(targetUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ms;q=0.8',
      'Cache-Control': 'no-cache',
      'Referer': 'https://shopee.com.my/'
    }
  });

  const finalUrl = response.url || targetUrl;
  const html = await response.text();
  let title = cleanShopeeTitle(pickTitleFromHtml(html));
  let description = shortenDescription(pickMeta(html, 'og:description') || pickMeta(html, 'description'), title);
  let image = pickMeta(html, 'og:image') || pickMeta(html, 'twitter:image');
  let source = title ? 'meta' : 'fallback';

  const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      const json = JSON.parse(m[1]);
      const arr = Array.isArray(json) ? json : [json];
      for (const obj of arr) {
        if (obj && obj.name && (!title || title.toLowerCase() === 'shopee')) {
          title = cleanShopeeTitle(obj.name);
          source = 'jsonld';
        }
        if (obj && obj.description && (!description || description.includes('Semak detail'))) {
          description = shortenDescription(obj.description, title);
        }
        if (obj && obj.image && !image) image = Array.isArray(obj.image) ? obj.image[0] : obj.image;
      }
    } catch(e) {}
  }

  if (!title || /^product$/i.test(title) || /^shopee$/i.test(title)) {
    const parts = decodeURIComponent(finalUrl).split('/').filter(Boolean);
    const maybe = parts.find(p => p.includes('-i.') || p.length > 20) || parts[parts.length - 1] || 'Affiliate Product';
    title = cleanShopeeTitle(maybe.replace(/-i\..*$/i, '').replace(/[-_]+/g, ' '));
    source = 'url-fallback';
  }

  const category = titleToCategory(title);
  return {
    ok: true,
    url: targetUrl,
    finalUrl,
    source,
    title,
    description,
    category,
    badge: titleToBadge(title, category),
    icon: titleToIcon(title),
    meta: titleToMeta(title, category),
    image: image || '',
    note: source === 'url-fallback'
      ? 'Shopee tidak bagi metadata lengkap. Sistem guna URL/keyword fallback. Sila semak sebelum Save.'
      : 'Auto filled daripada metadata page + keyword mapping. Sila semak sebelum Save.'
  };
}

async function handler(req, res) {

  try {

    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname || "/";

    if (req.method === "OPTIONS") {
      return send(res, 204, "");
    }

    // =========================
    // HEALTH
    // =========================

    if (pathname === "/health") {

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          server: "AZOBSS Backend Running",
          port: PORT
        }, null, 2),
        "application/json"
      );
    }


    // =========================
    // AFFILIATE PRODUCT AUTO DETECT
    // =========================

    if (
      pathname === "/api/detect-product" &&
      (req.method === "GET" || req.method === "POST")
    ) {
      let productUrl = parsed.query.url || parsed.query.link || "";

      if (req.method === "POST") {
        try {
          const body = await readBody(req);
          const data = JSON.parse(body || "{}");
          productUrl = data.url || data.link || productUrl;
        } catch (e) {}
      }

      try {
        const detected = await detectAffiliateProduct(productUrl);
        return send(res, 200, JSON.stringify(detected, null, 2), "application/json");
      } catch (err) {
        return send(res, 502, JSON.stringify({
          ok: false,
          error: err.message || "Auto detect failed",
          note: "Shopee mungkin block request. Paste product title atau isi manual jika gagal."
        }, null, 2), "application/json");
      }
    }

    // =========================
    // LOAD AFFILIATES
    // =========================

    if (
      pathname === "/api/affiliates" &&
      req.method === "GET"
    ) {

      if (!fs.existsSync(AFFILIATE_JSON)) {
        fs.writeFileSync(
          AFFILIATE_JSON,
          "[]",
          "utf8"
        );
      }

      return send(
        res,
        200,
        fs.readFileSync(AFFILIATE_JSON, "utf8"),
        "application/json"
      );
    }

    // =========================
    // SAVE AFFILIATES
    // =========================

    if (
      pathname === "/api/save-affiliates" &&
      req.method === "POST"
    ) {

      const body = await readBody(req);

      let data;

      try {
        data = JSON.parse(body);
      } catch (err) {

        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            error: "Invalid JSON"
          }),
          "application/json"
        );
      }

      fs.writeFileSync(
        AFFILIATE_JSON,
        JSON.stringify(data, null, 2),
        "utf8"
      );

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          saved: data.length
        }),
        "application/json"
      );
    }


    // =========================
    // JUPEM STESEN TANDA ARAS SEARCH
    // =========================

    if (
      pathname === "/api/stesen-tanda-aras" &&
      req.method === "GET"
    ) {
      const produk = cleanBenchmarkProduct(parsed.query.produk);
      const negeri = cleanState(parsed.query.negeri);
      const q = cleanSearch(parsed.query.q || parsed.query.carian);

      if (!negeri) {
        return send(
          res,
          400,
          JSON.stringify({ ok: false, error: "Missing negeri" }),
          "application/json"
        );
      }

      const sourceUrl =
        `https://ebiz.jupem.gov.my/Produk/StesenTandaAras?produk=${encodeURIComponent(produk)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(q)}`;

      const candidates = [
        sourceUrl,
        `https://ebiz.jupem.gov.my/Produk/StesenTandaAras?jenis=${encodeURIComponent(produk)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(q)}`,
        `https://ebiz.jupem.gov.my/Produk/StesenTandaAras?product=${encodeURIComponent(produk)}&state=${encodeURIComponent(negeri)}&search=${encodeURIComponent(q)}`,
        `https://ebiz.jupem.gov.my/Produk/StesenTandaAras`
      ];

      let lastError = "";

      for (const targetUrl of candidates) {
        try {
          console.log("Benchmark search:", targetUrl);
          const response = await fetch(targetUrl, {
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Referer": "https://ebiz.jupem.gov.my/Produk/StesenTandaAras"
            }
          });

          if (!response.ok) {
            lastError = `HTTP ${response.status}`;
            continue;
          }

          const html = await response.text();
          const results = parseBenchmarkRows(html, produk, negeri);

          if (results.length || targetUrl === candidates[candidates.length - 1]) {
            return send(
              res,
              200,
              JSON.stringify({
                ok: true,
                produk,
                negeri,
                q,
                sourceUrl,
                results,
                note: results.length ? "Results parsed from JUPEM eBiz page." : "No parsable table returned. Open sourceUrl to continue in eBiz JUPEM."
              }, null, 2),
              "application/json"
            );
          }
        } catch (err) {
          lastError = err.message;
        }
      }

      return send(
        res,
        502,
        JSON.stringify({ ok: false, error: lastError || "Benchmark search failed", sourceUrl }),
        "application/json"
      );
    }

    // =========================
    // JUPEM PA HOLD SYSTEM
    // =========================

    if (
      pathname === "/api/pa" &&
      req.method === "GET"
    ) {

      const noPA =
        cleanPA(parsed.query.noPA);

      const negeri =
        cleanState(parsed.query.negeri);

      if (!noPA) {

        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            error: "Missing noPA"
          }),
          "application/json"
        );
      }

      if (!negeri) {

        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            error: "Missing negeri"
          }),
          "application/json"
        );
      }

      fs.mkdirSync(
        TEMP_DIR,
        { recursive: true }
      );

      const fileName =
        `${noPA}.TIF`;

      const jupemUrl =
`https://ebiz.jupem.gov.my/MuatTurunPembelian/MuatTurunPelanAkui?noPa=${encodeURIComponent(fileName)}&negeri=${encodeURIComponent(negeri)}`;

      console.log(
        "Fetching:",
        jupemUrl
      );

      const response =
        await fetchJupem(jupemUrl);

      if (!response.ok) {

        return send(
          res,
          404,
          JSON.stringify({
            ok: false,
            error: "PA not found"
          }),
          "application/json"
        );
      }

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      const firstText =
        buffer
          .slice(0, 120)
          .toString("utf8")
          .toLowerCase();

      const looksHTML =
        firstText.includes("<html");

      if (
        !buffer.length ||
        looksHTML
      ) {

        return send(
          res,
          404,
          JSON.stringify({
            ok: false,
            error: "Invalid PA file"
          }),
          "application/json"
        );
      }

      const tempName =
`${noPA}.tif`;

      const tempPath =
        path.join(
          TEMP_DIR,
          tempName
        );

      // HOLD FILE
      fs.writeFileSync(
        tempPath,
        buffer
      );

      console.log(
        "PA Held:",
        tempName
      );

      const token =
        Math.random().toString(36).slice(2) + Date.now().toString(36);

      DOWNLOAD_TOKENS.set(token, {
        file: tempName,
        expires: Date.now() + 5 * 60 * 1000
      });

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          noPA,
          negeri,
          filename: tempName,
          size: buffer.length,
          download:
            `/api/download-pa/${tempName}?token=${token}`
        }, null, 2),
        "application/json"
      );
    }



// =========================
// JUPEM BM / SBM SECURE DOWNLOAD PROXY
// =========================

if (
  pathname === "/api/download-stesen-tanda-aras" &&
  req.method === "GET"
) {
  const productId = String(parsed.query.productId || parsed.query.id || "")
    .trim()
    .replace(/[^0-9]/g, "");

  const jenis = String(parsed.query.jenis || "1").trim() === "2" ? "2" : "1";

  if (!productId) {
    return send(
      res,
      400,
      JSON.stringify({ ok: false, error: "Missing productId" }),
      "application/json"
    );
  }

  const jupemUrl =
    `https://ebiz.jupem.gov.my/MuatTurunPembelian/MuatTurunStesenTandaAras/${encodeURIComponent(productId)}?jenis=${encodeURIComponent(jenis)}`;

  console.log("Fetching BM/SBM:", jupemUrl);

  const response = await fetchJupem(jupemUrl);

  if (!response.ok) {
    return send(
      res,
      404,
      JSON.stringify({ ok: false, error: "BM/SBM not found" }),
      "application/json"
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const firstText = buffer.slice(0, 160).toString("utf8").toLowerCase();

  if (!buffer.length || firstText.includes("<html")) {
    return send(
      res,
      404,
      JSON.stringify({ ok: false, error: "Invalid BM/SBM file" }),
      "application/json"
    );
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const safePrefix = jenis === "2" ? "SBM" : "BM";
  const ext = contentType.includes("pdf") ? "pdf" : (contentType.includes("zip") ? "zip" : "dat");

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${safePrefix}-${productId}.${ext}"`,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(buffer);
  return;
}

// =========================
// JUPEM PA PDF CONVERTER
// =========================

if (
  pathname === "/api/pa-pdf" &&
  req.method === "GET"
) {

  const noPA =
    cleanPA(parsed.query.noPA);

  const negeri =
    cleanState(parsed.query.negeri);

  if (!noPA) {
    return send(
      res,
      400,
      JSON.stringify({
        ok: false,
        error: "Missing noPA"
      }),
      "application/json"
    );
  }

  if (!negeri) {
    return send(
      res,
      400,
      JSON.stringify({
        ok: false,
        error: "Missing negeri"
      }),
      "application/json"
    );
  }

  const fileName =
    `${noPA}.TIF`;

  const jupemUrl =
`https://ebiz.jupem.gov.my/MuatTurunPembelian/MuatTurunPelanAkui?noPa=${encodeURIComponent(fileName)}&negeri=${encodeURIComponent(negeri)}`;

  console.log(
    "Fetching PDF:",
    jupemUrl
  );

  const response =
    await fetchJupem(jupemUrl);

  if (!response.ok) {
    return send(
      res,
      404,
      JSON.stringify({
        ok: false,
        error: "PA not found"
      }),
      "application/json"
    );
  }

  const tifBuffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  const firstText =
    tifBuffer
      .slice(0, 120)
      .toString("utf8")
      .toLowerCase();

  if (
    !tifBuffer.length ||
    firstText.includes("<html")
  ) {
    return send(
      res,
      404,
      JSON.stringify({
        ok: false,
        error: "Invalid PA file"
      }),
      "application/json"
    );
  }

  const pngBuffer =
    await sharp(tifBuffer)
      .png()
      .toBuffer();

  const meta =
    await sharp(pngBuffer)
      .metadata();

  const doc =
    new PDFDocument({
      autoFirstPage: false,
      margin: 0
    });

  const chunks = [];

  doc.on("data", chunk => chunks.push(chunk));

  doc.on("end", () => {
    const pdfBuffer =
      Buffer.concat(chunks);

const safeName =
      `${noPA}`.replace(/[^A-Z0-9_-]/gi, "");

    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        `attachment; filename="${safeName}.pdf"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    res.end(pdfBuffer);
  });

  doc.addPage({
    size: [meta.width, meta.height],
    margin: 0
  });

  doc.image(
    pngBuffer,
    0,
    0,
    {
      width: meta.width,
      height: meta.height
    }
  );

  doc.end();

  return;
}

// =========================
// SECURE PA DOWNLOAD
// =========================

if (
  pathname.startsWith("/api/download-pa/") &&
  req.method === "GET"
) {

  const fileName =
    path.basename(pathname);

  const token =
    parsed.query.token;

  const saved =
    DOWNLOAD_TOKENS.get(token);

  if (
    !saved ||
    saved.file !== fileName ||
    saved.expires < Date.now()
  ) {

    return send(
      res,
      403,
      "Unauthorized"
    );
  }

  // DOWNLOAD_TOKENS.delete(token); // allow IDM/browser retry

const filePath =
    path.join(TEMP_DIR, fileName);

  if (!fs.existsSync(filePath)) {

    return send(
      res,
      404,
      "File not found"
    );
  }

  res.writeHead(200, {
    "Content-Type": "image/tiff",
    "Content-Disposition":
      `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  fs.createReadStream(filePath)
    .pipe(res);

  return;
}


    // =========================
    // BLOCK DIRECT TEMP ACCESS
    // =========================

    if (
      pathname === "/temp" ||
      pathname.startsWith("/temp/")
    ) {
      return send(
        res,
        403,
        "Forbidden"
      );
    }

    // =========================
    // STATIC FILES
    // =========================

    const filePath =
      safePath(pathname);

    if (!filePath) {
      return send(res, 403, "Forbidden");
    }

    if (
      !fs.existsSync(filePath) ||
      fs.statSync(filePath).isDirectory()
    ) {

      return send(
        res,
        404,
        "File Not Found"
      );
    }

    const data =
      fs.readFileSync(filePath);

    return send(
      res,
      200,
      data,
      mimeType(filePath)
    );

  } catch (err) {

    console.error(err);

return send(
  res,
  500,
  JSON.stringify({
    ok: false,
    error: err.message,
    name: err.name,
    cause: err.cause
      ? String(err.cause)
      : null,
    stack: err.stack
  }, null, 2),
  "application/json"
);
  }
}

// =========================
// AUTO CLEAN TEMP FILES
// =========================

function cleanupTempFiles() {

  try {

    if (!fs.existsSync(TEMP_DIR)) {
      return;
    }

    const files =
      fs.readdirSync(TEMP_DIR);

    const now = Date.now();

    for (const file of files) {

      const fullPath =
        path.join(TEMP_DIR, file);

      try {

        const stat =
          fs.statSync(fullPath);

        const age =
          now - stat.mtimeMs;

        // DELETE FILE > 30 DAYS
        if (age > FILE_EXPIRE_MS) {

          fs.unlinkSync(fullPath);

          console.log(
            "Deleted old file:",
            file
          );
        }

      } catch (err) {

        console.error(
          "Cleanup file error:",
          file,
          err.message
        );
      }
    }

  } catch (err) {

    console.error(
      "Cleanup temp error:",
      err.message
    );
  }
}

// RUN EVERY 12 HOURS
setInterval(
  cleanupTempFiles,
  12 * 60 * 60 * 1000
);

// RUN ON STARTUP
cleanupTempFiles();

http.createServer(handler)
.listen(PORT, "0.0.0.0", () => {

  console.log("");
  console.log("================================");
  console.log(" AZOBSS BACKEND RUNNING");
  console.log("================================");
  console.log("PORT:", PORT);
  console.log("ROOT:", ROOT);
  console.log("================================");
  console.log("");

});