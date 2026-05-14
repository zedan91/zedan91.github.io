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


// =========================
// AFFILIATE PRODUCT AUTO-DETECT HELPERS
// =========================
function decodeHtmlEntity(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAffiliateText(value, max = 180) {
  return decodeHtmlEntity(value)
    .replace(/\| Shopee Malaysia/ig, "")
    .replace(/\| Shopee/ig, "")
    .replace(/Buy\s+/ig, "")
    .replace(/\s+-\s+Shopee.*$/ig, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function getMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["'][^>]*>`, "i")
  ];
  for (const p of patterns) {
    const m = String(html || "").match(p);
    if (m && m[1]) return cleanAffiliateText(m[1], 500);
  }
  return "";
}

function getTitleFromHtml(html) {
  return getMetaContent(html, "og:title") ||
    getMetaContent(html, "twitter:title") ||
    cleanAffiliateText((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "", 220);
}

function extractShopeeIds(rawUrl) {
  const u = String(rawUrl || "");
  let m = u.match(/\/product\/(\d+)\/(\d+)/i);
  if (m) return { shopid: m[1], itemid: m[2] };
  m = u.match(/i\.(\d+)\.(\d+)/i);
  if (m) return { shopid: m[1], itemid: m[2] };
  m = u.match(/[?&]shopid=(\d+).*?[?&]itemid=(\d+)/i) || u.match(/[?&]itemid=(\d+).*?[?&]shopid=(\d+)/i);
  if (m) {
    if (u.includes("shopid=")) return { shopid: m[1], itemid: m[2] };
    return { shopid: m[2], itemid: m[1] };
  }
  return null;
}

function affiliateCategoryFromTitle(title) {
  const t = String(title || "").toLowerCase();
  const has = (...words) => words.some(w => t.includes(w));

  if (has("ssd", "nvme", "ram", "router", "wifi", "keyboard", "mouse", "monitor", "pc", "computer", "laptop", "printer", "usb", "pendrive", "hard disk", "hdd"))
    return { category: "computer", badge: has("ssd", "nvme") ? "Fast Storage" : "Computer & Accessories", icon: has("ssd", "nvme") ? "SSD" : "💻", meta: has("ssd", "nvme") ? "Best for Windows and game loading" : "Useful for PC setup" };
  if (has("vacuum", "mop", "organizer", "rak", "storage box", "lamp", "light", "table", "chair", "sofa", "cleaner"))
    return { category: "home-living", badge: "Useful Gadget", icon: has("vacuum") ? "Vac" : "🏠", meta: "Best for home daily use" };
  if (has("blender", "grinder", "air fryer", "rice cooker", "kettle", "oven", "mixer", "chopper"))
    return { category: "home-appliances", badge: "Kitchen Tool", icon: "🍳", meta: "Best for kitchen use" };
  if (has("dashcam", "car", "kereta", "tyre", "tire", "jump starter", "compressor", "parking", "motor"))
    return { category: "automotive", badge: "Car Gadget", icon: "🚗", meta: "Useful for car owners" };
  if (has("camera", "drone", "gimbal", "tripod", "lens", "cctv"))
    return { category: "camera", badge: "Camera Gear", icon: "📷", meta: "Best for photo and video use" };
  if (has("phone", "iphone", "android", "charger", "powerbank", "cable", "case", "screen protector", "earbuds", "earphone"))
    return { category: "mobile", badge: "Mobile Accessory", icon: "📱", meta: "Useful phone accessory" };
  if (has("watch", "smartwatch", "jam tangan"))
    return { category: "watches", badge: "Watch", icon: "⌚", meta: "Useful daily wearable" };
  if (has("bag", "wallet", "purse"))
    return { category: t.includes("women") || t.includes("wanita") ? "womens-bags" : "mens-bags", badge: "Daily Carry", icon: "👜", meta: "Best for daily use" };
  if (has("dress", "shirt", "baju", "tshirt", "t-shirt", "pants", "seluar", "jacket"))
    return { category: t.includes("women") || t.includes("wanita") ? "women-clothes" : "men-clothes", badge: "Fashion", icon: "👕", meta: "Daily outfit item" };
  if (has("shoe", "shoes", "sandal", "kasut", "sneaker"))
    return { category: t.includes("women") || t.includes("wanita") ? "women-shoes" : "men-shoes", badge: "Shoes", icon: "👟", meta: "Daily wear" };
  if (has("baby", "toy", "toys", "kids", "kanak", "mainan"))
    return { category: "baby", badge: "Family Pick", icon: "🧸", meta: "Best for kids and family" };
  if (has("beauty", "skincare", "serum", "cream", "shampoo", "soap", "ubat", "health"))
    return { category: "health", badge: "Self Care", icon: "💆", meta: "Health and beauty item" };
  if (has("game", "gaming", "console", "ps5", "xbox", "nintendo"))
    return { category: "gaming", badge: "Gaming", icon: "🎮", meta: "Best for gaming setup" };
  if (has("camping", "sport", "outdoor", "fitness", "gym", "bike", "bicycle"))
    return { category: "sports", badge: "Outdoor", icon: "🏕️", meta: "Best for outdoor use" };

  return { category: "others", badge: "Useful Item", icon: "🛒", meta: "Best for useful daily item" };
}

function makeAffiliateDescription(title, category) {
  const t = cleanAffiliateText(title, 160);
  const lower = t.toLowerCase();
  if (lower.includes("vacuum")) return "Vacuum mudah alih untuk kegunaan rumah atau kereta. Sesuai untuk habuk, celah kerusi dan pembersihan harian.";
  if (lower.includes("ssd") || lower.includes("nvme")) return "Storage laju untuk upgrade PC atau laptop. Sesuai untuk Windows, game loading dan kerja harian.";
  if (lower.includes("router") || lower.includes("wifi")) return "Peralatan rangkaian untuk sambungan internet rumah atau pejabat yang lebih kemas dan stabil.";
  if (category === "automotive") return "Aksesori kereta yang berguna untuk kegunaan harian, travel dan kecemasan kecil dalam kereta.";
  if (category === "home-living" || category === "home-appliances") return "Barang berguna untuk rumah yang boleh bantu mudahkan kerja harian dan susun ruang dengan lebih kemas.";
  if (category === "computer") return "Aksesori komputer yang sesuai untuk setup kerja, gaming atau upgrade PC harian.";
  return `${t || "Produk ini"} sesuai untuk kegunaan harian. Semak detail produk di Shopee sebelum membeli.`;
}

async function fetchTextWithBrowserHeaders(targetUrl, referer = "https://shopee.com.my/") {
  const response = await fetch(targetUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ms;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": referer
    }
  });
  return { response, text: await response.text() };
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
    // AFFILIATE PRODUCT AUTO-DETECT
    // =========================

    if (
      pathname === "/api/detect-product" &&
      req.method === "GET"
    ) {
      const inputUrl = String(parsed.query.url || "").trim();

      if (!/^https?:\/\//i.test(inputUrl)) {
        return send(
          res,
          400,
          JSON.stringify({ ok: false, error: "Missing or invalid product URL" }),
          "application/json"
        );
      }

      let finalUrl = inputUrl;
      let title = "";
      let image = "";
      let source = "fallback";
      let rawDescription = "";
      let shopeeIds = extractShopeeIds(inputUrl);

      try {
        const first = await fetch(inputUrl, {
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,ms;q=0.8",
            "Referer": "https://shopee.com.my/"
          }
        });

        finalUrl = first.url || inputUrl;
        const html = await first.text();
        shopeeIds = shopeeIds || extractShopeeIds(finalUrl);

        title = getTitleFromHtml(html);
        image = getMetaContent(html, "og:image") || getMetaContent(html, "twitter:image");
        rawDescription = getMetaContent(html, "og:description") || getMetaContent(html, "description");
        if (title) source = "html-meta";
      } catch (err) {
        // Continue to Shopee item API / fallback.
      }

      // Stronger method for Shopee full product links.
      // This often gives better real product data than page scraping.
      if (shopeeIds && shopeeIds.shopid && shopeeIds.itemid) {
        const apiUrls = [
          `https://shopee.com.my/api/v4/item/get?shopid=${encodeURIComponent(shopeeIds.shopid)}&itemid=${encodeURIComponent(shopeeIds.itemid)}`,
          `https://shopee.com.my/api/v2/item/get?shopid=${encodeURIComponent(shopeeIds.shopid)}&itemid=${encodeURIComponent(shopeeIds.itemid)}`
        ];

        for (const apiUrl of apiUrls) {
          try {
            const apiRes = await fetch(apiUrl, {
              redirect: "follow",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "application/json,text/plain,*/*",
                "Accept-Language": "en-US,en;q=0.9,ms;q=0.8",
                "X-API-SOURCE": "pc",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": finalUrl || inputUrl
              }
            });

            const raw = await apiRes.text();
            if (!raw.trim().startsWith("{")) continue;

            const data = JSON.parse(raw);
            const item = data.item || data.data || data;
            const apiTitle = item.name || item.title || "";
            if (apiTitle) {
              title = cleanAffiliateText(apiTitle, 220);
              rawDescription = cleanAffiliateText(item.description || rawDescription || "", 350);
              if (item.image && !image) {
                image = String(item.image).startsWith("http")
                  ? item.image
                  : `https://down-my.img.susercontent.com/file/${item.image}`;
              }
              source = "shopee-api";
              break;
            }
          } catch (err) {
            // Try next API / fallback.
          }
        }
      }

      // Last fallback: create a readable title from URL slug if available.
      if (!title) {
        const slug = decodeURIComponent((finalUrl || inputUrl).split("?")[0].split("/").pop() || "");
        title = cleanAffiliateText(slug.replace(/[-_]+/g, " "), 160) || "Shopee Product";
      }

      const detected = affiliateCategoryFromTitle(title + " " + rawDescription);
      const description = rawDescription && rawDescription.length > 35
        ? cleanAffiliateText(rawDescription, 220)
        : makeAffiliateDescription(title, detected.category);

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          source,
          url: inputUrl,
          finalUrl,
          shopid: shopeeIds ? shopeeIds.shopid : "",
          itemid: shopeeIds ? shopeeIds.itemid : "",
          title: cleanAffiliateText(title, 220),
          description,
          category: detected.category,
          badge: detected.badge,
          icon: detected.icon,
          meta: detected.meta,
          image,
          note: source === "fallback" ? "Shopee mungkin block. Sila semak dan edit sebelum Save." : "Auto filled from product data. Sila semak sebelum Save."
        }, null, 2),
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