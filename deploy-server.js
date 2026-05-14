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

function getBenchmarkJenis(produk) {
  return cleanBenchmarkProduct(produk) === 'SBM' ? 2 : 1;
}

function cleanBenchmarkId(value) {
  const text = String(value || '').trim();
  const patterns = [
    /ProductID\s*=\s*(\d{1,12})/i,
    /MuatTurunStesenTandaAras\/(\d{1,12})/i,
    /GeodetikTroliTandaAras\?[^\s'\"]*ProductID=(\d{1,12})/i,
    /(?:^|\D)([1-9]\d{2,11})(?:\D|$)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].replace(/^0+(?=\d)/, '');
  }
  return '';
}

function extractBenchmarkJenis(value, fallbackProduk) {
  const text = String(value || '');
  const match = text.match(/jenis\s*=\s*([12])/i);
  if (match) return Number(match[1]);
  return getBenchmarkJenis(fallbackProduk);
}

function buildBenchmarkDownloadUrl(id, produk, jenisOverride) {
  const cleanId = cleanBenchmarkId(id);
  if (!cleanId) return '';
  const jenis = jenisOverride === 2 || String(jenisOverride) === '2' ? 2 : getBenchmarkJenis(produk);
  return `https://ebiz.jupem.gov.my/MuatTurunPembelian/MuatTurunStesenTandaAras/${encodeURIComponent(cleanId)}?jenis=${jenis}`;
}

function extractBenchmarkId(rowHtml) {
  const text = String(rowHtml || '');
  const patterns = [
    /GeodetikTroliTandaAras\?[^'\"]*ProductID=(\d{1,12})/i,
    /ProductID\s*=\s*(\d{1,12})/i,
    /MuatTurunStesenTandaAras\/(\d{1,12})/i,
    /TambahKeTroli\/(\d{1,12})/i,
    /data[-_](?:id|item|produk)=['\"]?(\d{1,12})/i,
    /value=['\"]?(\d{2,12})['\"]?/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].replace(/^0+(?=\d)/, '');
  }
  return '';
}

function cleanSearch(value) {
  return String(value || '')
    .trim()
    .replace(/[<>]/g, '')
    .slice(0, 120);
}

function normalizeBenchmarkSearch(value) {
  let text = cleanSearch(value).toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // eBiz No. Stesen sebenar dipaparkan sebagai contoh: H 0109, bukan 0109 sahaja.
  const hMatch = text.match(/^H\s*(\d{3,6})$/);
  if (hMatch) return `H ${hMatch[1]}`;

  if (/^\d{3,6}$/.test(text)) {
    return `H ${text}`;
  }

  return text;
}

function getBenchmarkSearchTerms(value) {
  const raw = cleanSearch(value);
  const normalized = normalizeBenchmarkSearch(raw);
  const compactH = normalized.replace(/^H\s+(\d+)$/i, 'H$1');
  const terms = [normalized, compactH, raw]
    .map(item => String(item || '').trim())
    .filter(Boolean);
  return Array.from(new Set(terms));
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


function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHtmlAttributes(tag) {
  const attrs = {};
  String(tag || '').replace(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi, function (_, key, quote, value) {
    attrs[key.toLowerCase()] = decodeHtmlEntities(value);
    return '';
  });
  return attrs;
}

function parseHiddenInputs(html) {
  const fields = {};
  String(html || '').replace(/<input\b[^>]*>/gi, function (tag) {
    const attrs = parseHtmlAttributes(tag);
    if ((attrs.type || '').toLowerCase() === 'hidden' && attrs.name) {
      fields[attrs.name] = attrs.value || '';
    }
    return '';
  });
  return fields;
}

function findOptionValueByText(html, wantedTexts) {
  const wants = (Array.isArray(wantedTexts) ? wantedTexts : [wantedTexts])
    .map(item => String(item || '').toLowerCase())
    .filter(Boolean);
  let found = '';
  String(html || '').replace(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi, function (_, attrText, labelHtml) {
    if (found) return '';
    const label = stripHtml(labelHtml).toLowerCase();
    if (!label || wants.some(want => label.includes(want))) {
      if (label && wants.some(want => label.includes(want))) {
        const attrs = parseHtmlAttributes(attrText);
        found = attrs.value || stripHtml(labelHtml);
      }
    }
    return '';
  });
  return found;
}

function buildBenchmarkFormBodies(baseHtml, produk, negeri, q) {
  const jenis = getBenchmarkJenis(produk);
  const hidden = parseHiddenInputs(baseHtml);
  const productLabelHints = jenis === 2
    ? ['stesen tanda aras piawai', 'sbm']
    : ['stesen tanda aras (bm)', 'stesen tanda aras bm'];
  const productValue = findOptionValueByText(baseHtml, productLabelHints) || String(jenis);
  const stateValue = findOptionValueByText(baseHtml, [negeri]) || negeri;
  const base = {
    ...hidden,
    produk,
    Produk: produk,
    product: produk,
    Product: produk,
    jenis: String(jenis),
    Jenis: String(jenis),
    IdProduk: String(jenis),
    ProductType: String(jenis),
    Negeri: stateValue,
    negeri: stateValue,
    state: negeri,
    State: negeri,
    KodNegeri: stateValue,
    kodNegeri: stateValue,
    Carian: q,
    carian: q,
    Search: q,
    search: q,
    SearchString: q,
    keyword: q,
    q
  };
  return [
    { ...base, Produk: productValue, produk: productValue },
    { ...base, jenis: String(jenis), Jenis: String(jenis), Produk: String(jenis), produk: String(jenis) },
    { ...base, JenisProduk: String(jenis), jenisProduk: String(jenis), Negeri: negeri },
    { ...base, ddlProduk: productValue, ddlNegeri: stateValue, txtCarian: q },
    { ...base, productId: productValue, stateId: stateValue, term: q }
  ];
}

function encodeForm(data) {
  const params = new URLSearchParams();
  Object.entries(data || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.set(key, String(value));
  });
  return params.toString();
}

function parseBenchmarkJsonPayload(payload, produkFallback, negeriFallback) {
  const rows = [];
  const visit = value => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') return;

    const idRaw = value.ProductID || value.productId || value.ProductId || value.ID || value.Id || value.id || value.ProdukID || value.produkId;
    const id = cleanBenchmarkId(idRaw || JSON.stringify(value));
    const jenis = Number(value.jenis || value.Jenis || value.ProductType || value.productType || getBenchmarkJenis(produkFallback));
    const product = jenis === 2 ? 'SBM' : 'BM';
    const stationNo = value.NoStesen || value.noStesen || value.No || value.no || value.Stesen || value.stesen || value.Kod || value.kod || value.Nama || value.name || id;
    if (id || stationNo) {
      rows.push({
        id,
        jenis,
        product,
        stationNo: String(stationNo || id || '').trim(),
        negeri: value.Negeri || value.negeri || negeriFallback,
        daerah: value.Daerah || value.daerah || '',
        bandar: value.Bandar || value.bandar || '',
        huraian: value.Huraian || value.huraian || value.Keterangan || value.keterangan || '',
        harga: value.Harga || value.harga || value.Price || value.price || '',
        locationUrl: absolutizeJupemUrl(value.LocationUrl || value.locationUrl || value.UrlLokasi || value.urlLokasi || ''),
        downloadUrl: id ? buildBenchmarkDownloadUrl(id, product, jenis) : '',
        raw: value
      });
    }
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object') visit(child);
    });
  };
  visit(payload);
  const seen = new Set();
  return rows.filter(item => {
    const key = [item.id, item.stationNo, item.jenis].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 60);
}

async function fetchBenchmarkCandidate(urlToFetch, options = {}) {
  const response = await fetch(urlToFetch, {
    redirect: 'follow',
    method: options.method || 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': options.accept || 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
      'Content-Type': options.contentType || 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://ebiz.jupem.gov.my',
      'Referer': 'https://ebiz.jupem.gov.my/Produk/StesenTandaAras'
    },
    body: options.body
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text, contentType: response.headers.get('content-type') || '' };
}

async function searchBenchmarkFromEbiz(produk, negeri, q) {
  const jenis = getBenchmarkJenis(produk);
  const baseUrl = 'https://ebiz.jupem.gov.my/Produk/StesenTandaAras';
  const baseResponse = await fetchBenchmarkCandidate(baseUrl, { method: 'GET' });
  const baseHtml = baseResponse.text || '';
  const searchTerms = getBenchmarkSearchTerms(q);

  let lastError = '';
  let firstSourceUrl = '';

  for (const searchTerm of searchTerms) {
    const bodies = buildBenchmarkFormBodies(baseHtml, produk, negeri, searchTerm);
    const urls = [
      `${baseUrl}?jenis=${encodeURIComponent(jenis)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(searchTerm)}`,
      `${baseUrl}?Jenis=${encodeURIComponent(jenis)}&Negeri=${encodeURIComponent(negeri)}&Carian=${encodeURIComponent(searchTerm)}`,
      `${baseUrl}?produk=${encodeURIComponent(produk)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(searchTerm)}`,
      `${baseUrl}?Produk=${encodeURIComponent(jenis)}&Negeri=${encodeURIComponent(negeri)}&SearchString=${encodeURIComponent(searchTerm)}`,
      `https://ebiz.jupem.gov.my/Produk/GetStesenTandaAras?jenis=${encodeURIComponent(jenis)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(searchTerm)}`,
      `https://ebiz.jupem.gov.my/Produk/GetStesenTandaArasList?jenis=${encodeURIComponent(jenis)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(searchTerm)}`,
      `https://ebiz.jupem.gov.my/Produk/CarianStesenTandaAras?jenis=${encodeURIComponent(jenis)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(searchTerm)}`,
      `https://ebiz.jupem.gov.my/Produk/StesenTandaArasSenarai?jenis=${encodeURIComponent(jenis)}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(searchTerm)}`
    ];

    if (!firstSourceUrl) firstSourceUrl = urls[0];

    const attempts = [];
    urls.forEach(url => attempts.push({ method: 'GET', url, searchTerm }));
    [baseUrl, ...urls.slice(4)].forEach(url => {
      bodies.forEach(body => attempts.push({ method: 'POST', url, body: encodeForm(body), searchTerm }));
    });

    for (const attempt of attempts) {
      try {
        const result = await fetchBenchmarkCandidate(attempt.url, {
          method: attempt.method,
          body: attempt.method === 'POST' ? attempt.body : undefined
        });
        if (!result.ok) {
          lastError = `HTTP ${result.status} from ${attempt.url}`;
          continue;
        }
        let rows = [];
        const trimmed = result.text.trim();
        if (/^[\[{]/.test(trimmed) || /json/i.test(result.contentType)) {
          try { rows = parseBenchmarkJsonPayload(JSON.parse(trimmed), produk, negeri); } catch (error) {}
        }
        if (!rows.length) rows = parseBenchmarkRows(result.text, produk, negeri);
        if (rows.length) {
          return { rows, sourceUrl: attempt.url, method: attempt.method, searchTerm: attempt.searchTerm, note: `Auto search parsed ProductID from eBiz JUPEM result using No. Stesen ${attempt.searchTerm}.` };
        }
      } catch (error) {
        lastError = error.message;
      }
    }
  }

  return { rows: [], sourceUrl: firstSourceUrl || baseUrl, method: 'GET', searchTerm: searchTerms[0] || q, note: lastError || 'No ProductID found in eBiz response.' };
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
    const itemId = extractBenchmarkId(rowHtml);
    const itemJenis = extractBenchmarkJenis(rowHtml, produkFallback);
    const itemProduct = itemJenis === 2 ? 'SBM' : 'BM';
    const stationNo = cells[1] || cells[0] || itemId || '';
    if (!stationNo || /^no\.?$/i.test(stationNo)) continue;

    rows.push({
      id: itemId,
      jenis: itemJenis,
      product: itemProduct,
      stationNo,
      negeri: cells[2] || negeriFallback,
      daerah: cells[3] || '',
      bandar: cells[4] || '',
      huraian: cells[5] || '',
      harga: cells[6] || '',
      locationUrl: linkMatch ? absolutizeJupemUrl(linkMatch[1]) : '',
      downloadUrl: itemId ? buildBenchmarkDownloadUrl(itemId, itemProduct, itemJenis) : '',
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

      const directId = cleanBenchmarkId(q);
      const directJenis = extractBenchmarkJenis(q, produk);
      const isExplicitProductId = /ProductID\s*=|MuatTurunStesenTandaAras\/|GeodetikTroliTandaAras\?/i.test(q) || (/^[1-9]\d{2,11}$/.test(q) && !/^0/.test(q));

      const normalizedSearch = normalizeBenchmarkSearch(q);
      const sourceUrl =
        `https://ebiz.jupem.gov.my/Produk/StesenTandaAras?jenis=${encodeURIComponent(getBenchmarkJenis(produk))}&negeri=${encodeURIComponent(negeri)}&carian=${encodeURIComponent(normalizedSearch || q)}`;

      if (directId && isExplicitProductId) {
        const directProduct = directJenis === 2 ? 'SBM' : produk;
        return send(
          res,
          200,
          JSON.stringify({
            ok: true,
            produk: directProduct,
            negeri,
            q,
            sourceUrl,
            results: [{
              id: directId,
              jenis: directJenis,
              product: directProduct,
              stationNo: q || directId,
              negeri,
              daerah: '',
              bandar: '',
              huraian: 'Direct eBiz ProductID/cart link detected.',
              harga: '',
              locationUrl: '',
              downloadUrl: buildBenchmarkDownloadUrl(directId, directProduct, directJenis),
              raw: []
            }],
            note: 'Direct ProductID detected and download link generated.'
          }, null, 2),
          "application/json"
        );
      }

      let autoSearch;
      try {
        autoSearch = await searchBenchmarkFromEbiz(produk, negeri, q);
      } catch (error) {
        autoSearch = { rows: [], sourceUrl, note: error.message || 'Auto search failed.' };
      }

      if (autoSearch.rows && autoSearch.rows.length) {
        return send(
          res,
          200,
          JSON.stringify({
            ok: true,
            produk,
            negeri,
            q,
            sourceUrl: autoSearch.sourceUrl || sourceUrl,
            results: autoSearch.rows,
            note: autoSearch.note || 'Auto search parsed ProductID from eBiz JUPEM.'
          }, null, 2),
          "application/json"
        );
      }

      const fallbackId = cleanBenchmarkId(q);
      if (fallbackId && isExplicitProductId) {
        const fallbackJenis = extractBenchmarkJenis(q, produk);
        const fallbackProduct = fallbackJenis === 2 ? 'SBM' : produk;
        return send(
          res,
          200,
          JSON.stringify({
            ok: true,
            produk: fallbackProduct,
            negeri,
            q,
            sourceUrl,
            results: [{
              id: fallbackId,
              jenis: fallbackJenis,
              product: fallbackProduct,
              stationNo: q || fallbackId,
              negeri,
              daerah: '',
              bandar: '',
              huraian: 'Direct eBiz ProductID lookup',
              harga: '',
              locationUrl: '',
              downloadUrl: buildBenchmarkDownloadUrl(fallbackId, fallbackProduct, fallbackJenis),
              raw: []
            }],
            note: 'Search page could not be parsed, but a ProductID was detected and direct download link was generated.'
          }, null, 2),
          "application/json"
        );
      }

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          produk,
          negeri,
          q,
          sourceUrl,
          results: [],
          note: autoSearch && autoSearch.note ? autoSearch.note : 'No ProductID found. Open sourceUrl in eBiz JUPEM and inspect cart ProductID if needed.'
        }, null, 2),
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