// AZOBSS Render Backend Server
// Supports: website hosting + affiliate online sync + JUPEM PA hold system

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const crypto = require("crypto");

const sharp = require("sharp");
const PDFDocument = require("pdfkit");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();

const AFFILIATE_JSON = path.join(ROOT, "affiliate-products.json");
const LUCKY_DRAW_JSON = path.join(ROOT, "lucky-draw-entries.json");
const USER_EMAIL_MAP_JSON = path.join(ROOT, "user-login-emails.json");
const TEMP_DIR = path.join(ROOT, "temp");
const DOWNLOAD_TOKENS = new Map();
const ADMIN_USERNAME = "zedan91";

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

function cleanUsernameKey(value) {

  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function cleanLuckyDrawMonth(value) {

  const monthKey =
    String(value || "").trim();

  return /^\d{4}-\d{2}$/.test(monthKey)
    ? monthKey
    : "";
}

function cleanHash(value) {

  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

function cleanEmail(value) {

  const email = String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 160);

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function readJsonObject(filePath, fallback) {

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJsonObject(filePath, data) {

  const tempPath = filePath + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function clientIp(req) {

  const forwarded =
    req.headers["x-forwarded-for"];

  const raw =
    Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded || req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "";

  return String(raw)
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "");
}

function readLuckyDrawStore() {

  if (!fs.existsSync(LUCKY_DRAW_JSON)) {
    return {
      entries: [],
      results: [],
      settings: {}
    };
  }

  try {
    const parsed =
      JSON.parse(fs.readFileSync(LUCKY_DRAW_JSON, "utf8"));

    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}
    };
  } catch (err) {
    return {
      entries: [],
      results: [],
      settings: {}
    };
  }
}

function saveLuckyDrawStore(store) {

  const tempPath =
    `${LUCKY_DRAW_JSON}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(store, null, 2),
    "utf8"
  );

  fs.renameSync(tempPath, LUCKY_DRAW_JSON);
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
    // LUCKY DRAW FALLBACK
    // =========================

    if (pathname === "/api/user-login-email" && req.method === "GET") {
      const usernameKey = cleanUsernameKey(parsed.query.usernameKey);
      const emailMap = readJsonObject(USER_EMAIL_MAP_JSON, {});
      return send(res, 200, JSON.stringify({ ok: true, email: usernameKey ? cleanEmail(emailMap[usernameKey]) : "" }), "application/json");
    }

    if (pathname === "/api/signup-map" && req.method === "POST") {
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (err) {
        return send(res, 400, JSON.stringify({ ok: false, code: "invalid-json" }), "application/json");
      }
      const usernameKey = cleanUsernameKey(data.usernameKey);
      const email = cleanEmail(data.email);
      if (!usernameKey || !email) {
        return send(res, 400, JSON.stringify({ ok: false, code: "missing-fields" }), "application/json");
      }
      const emailMap = readJsonObject(USER_EMAIL_MAP_JSON, {});
      emailMap[usernameKey] = email;
      saveJsonObject(USER_EMAIL_MAP_JSON, emailMap);
      return send(res, 200, JSON.stringify({ ok: true }), "application/json");
    }

    if (pathname === "/api/lucky-draw/settings" && req.method === "GET") {
      const monthKey = cleanLuckyDrawMonth(parsed.query.monthKey);
      const store = readLuckyDrawStore();
      const settings = store.settings || {};
      return send(res, 200, JSON.stringify({ ok: true, monthKey, open: settings.open === true && (!settings.monthKey || settings.monthKey === monthKey) }), "application/json");
    }

    if (pathname === "/api/lucky-draw/settings" && req.method === "POST") {
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (err) {
        return send(res, 400, JSON.stringify({ ok: false, code: "invalid-json" }), "application/json");
      }
      const adminKey = cleanUsernameKey(data.adminKey);
      const monthKey = cleanLuckyDrawMonth(data.monthKey);
      if (adminKey !== ADMIN_USERNAME || !monthKey) {
        return send(res, 403, JSON.stringify({ ok: false, code: "admin-only" }), "application/json");
      }
      const store = readLuckyDrawStore();
      store.settings = { open: data.open === true, monthKey, updatedBy: adminKey, updatedAtMs: Date.now() };
      saveLuckyDrawStore(store);
      return send(res, 200, JSON.stringify({ ok: true, open: store.settings.open }), "application/json");
    }


    if (
      pathname === "/api/lucky-draw" &&
      req.method === "GET"
    ) {

      const monthKey =
        cleanLuckyDrawMonth(parsed.query.monthKey);

      const usernameKey =
        cleanUsernameKey(parsed.query.usernameKey);

      if (!monthKey) {
        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            code: "missing-month"
          }),
          "application/json"
        );
      }

      const store =
        readLuckyDrawStore();

      const entries =
        store.entries.filter(entry => entry.monthKey === monthKey);

      const result =
        store.results.find(item => item.monthKey === monthKey) || null;

      const userEntry =
        usernameKey
          ? entries.find(entry => entry.usernameKey === usernameKey)
          : null;

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          monthKey,
          entryCount: entries.length,
          alreadyJoined: Boolean(userEntry),
          winnerPicked: Boolean(result),
          winnerName: result ? result.winnerName : "",
          winnerUsernameKey: result ? result.winnerUsernameKey : "",
          open: store.settings && store.settings.open === true && (!store.settings.monthKey || store.settings.monthKey === monthKey),
          entries: usernameKey === ADMIN_USERNAME
            ? entries.map(entry => ({
              id: entry.id,
              monthKey: entry.monthKey,
              usernameKey: entry.usernameKey,
              name: entry.name,
              phone: entry.phone,
              contactEmail: entry.contactEmail || "",
              deviceHash: entry.deviceHash || "",
              ipAddress: entry.ipAddress || "",
              inviteCode: entry.inviteCode || "",
              inviteUrl: entry.inviteUrl || "",
              shareFacebookAtMs: entry.shareFacebookAtMs || 0,
              shareThreadsAtMs: entry.shareThreadsAtMs || 0,
              adminNote: entry.adminNote || "",
              createdAtMs: entry.createdAtMs
            }))
            : []
        }),
        "application/json"
      );
    }

    if (
      pathname === "/api/lucky-draw/join" &&
      req.method === "POST"
    ) {

      let data;

      try {
        data = JSON.parse(await readBody(req));
      } catch (err) {
        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            code: "invalid-json"
          }),
          "application/json"
        );
      }

      const monthKey =
        cleanLuckyDrawMonth(data.monthKey);

      const usernameKey =
        cleanUsernameKey(data.usernameKey);

      const deviceHash =
        cleanHash(data.deviceHash);

      const ipAddress =
        clientIp(req);

      if (!monthKey || !usernameKey || !deviceHash || !ipAddress) {
        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            code: "missing-fields"
          }),
          "application/json"
        );
      }

      const store =
        readLuckyDrawStore();

      const monthEntries =
        store.entries.filter(entry => entry.monthKey === monthKey);

      if (!store.settings || store.settings.open !== true || (store.settings.monthKey && store.settings.monthKey !== monthKey)) {
        return send(
          res,
          409,
          JSON.stringify({
            ok: false,
            code: "draw-not-open"
          }),
          "application/json"
        );
      }

      if (store.results.some(item => item.monthKey === monthKey)) {
        return send(
          res,
          409,
          JSON.stringify({
            ok: false,
            code: "draw-closed"
          }),
          "application/json"
        );
      }

      if (monthEntries.some(entry => entry.usernameKey === usernameKey)) {
        return send(
          res,
          409,
          JSON.stringify({
            ok: false,
            code: "already-joined"
          }),
          "application/json"
        );
      }

      if (monthEntries.some(entry => entry.deviceHash === deviceHash)) {
        return send(
          res,
          409,
          JSON.stringify({
            ok: false,
            code: "device-used"
          }),
          "application/json"
        );
      }

      if (monthEntries.some(entry => entry.ipAddress === ipAddress)) {
        return send(
          res,
          409,
          JSON.stringify({
            ok: false,
            code: "ip-used"
          }),
          "application/json"
        );
      }

      const entry = {
        id: `${monthKey}_${usernameKey}`,
        monthKey,
        usernameKey,
        name: String(data.name || usernameKey).trim().slice(0, 100),
        phone: String(data.phone || "").trim().slice(0, 40),
        contactEmail: String(data.contactEmail || "").trim().slice(0, 120),
        emailVerified: data.emailVerified === true,
        inviteCode: cleanHash(data.inviteCode),
        inviteUrl: String(data.inviteUrl || "").trim().slice(0, 300),
        shareFacebookAtMs: Number(data.shareFacebookAtMs || 0),
        shareThreadsAtMs: Number(data.shareThreadsAtMs || 0),
        deviceHash,
        ipAddress,
        createdAtMs: Date.now()
      };

      store.entries.push(entry);
      saveLuckyDrawStore(store);

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          entry,
          entryCount: monthEntries.length + 1
        }),
        "application/json"
      );
    }

    if (pathname === "/api/lucky-draw/entry" && req.method === "POST") {
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (err) {
        return send(res, 400, JSON.stringify({ ok: false, code: "invalid-json" }), "application/json");
      }
      const adminKey = cleanUsernameKey(data.adminKey);
      const monthKey = cleanLuckyDrawMonth(data.monthKey);
      const entryId = String(data.entryId || "").trim().slice(0, 140);
      if (adminKey !== ADMIN_USERNAME || !monthKey || !entryId) {
        return send(res, 403, JSON.stringify({ ok: false, code: "admin-only" }), "application/json");
      }
      const store = readLuckyDrawStore();
      const entry = store.entries.find(item => item.monthKey === monthKey && item.id === entryId);
      if (!entry) {
        return send(res, 404, JSON.stringify({ ok: false, code: "entry-not-found" }), "application/json");
      }
      entry.name = String(data.name || entry.name || "").trim().slice(0, 100);
      entry.phone = String(data.phone || entry.phone || "").trim().slice(0, 40);
      entry.contactEmail = String(data.contactEmail || entry.contactEmail || "").trim().slice(0, 120);
      entry.adminNote = String(data.adminNote || "").trim().slice(0, 500);
      entry.updatedBy = adminKey;
      entry.updatedAtMs = Date.now();
      saveLuckyDrawStore(store);
      return send(res, 200, JSON.stringify({ ok: true, entry }), "application/json");
    }

    if (
      pathname === "/api/lucky-draw/pick" &&
      req.method === "POST"
    ) {

      let data;

      try {
        data = JSON.parse(await readBody(req));
      } catch (err) {
        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            code: "invalid-json"
          }),
          "application/json"
        );
      }

      const monthKey =
        cleanLuckyDrawMonth(data.monthKey);

      const pickedBy =
        cleanUsernameKey(data.pickedBy);

      if (!monthKey || pickedBy !== ADMIN_USERNAME) {
        return send(
          res,
          403,
          JSON.stringify({
            ok: false,
            code: "admin-only"
          }),
          "application/json"
        );
      }

      const store =
        readLuckyDrawStore();

      if (store.results.some(item => item.monthKey === monthKey)) {
        return send(
          res,
          409,
          JSON.stringify({
            ok: false,
            code: "winner-exists"
          }),
          "application/json"
        );
      }

      const entries =
        store.entries.filter(entry => entry.monthKey === monthKey);

      if (!entries.length) {
        return send(
          res,
          400,
          JSON.stringify({
            ok: false,
            code: "no-entries"
          }),
          "application/json"
        );
      }

      const winner =
        entries[crypto.randomInt(entries.length)];

      const result = {
        monthKey,
        winnerEntryId: winner.id,
        winnerUsernameKey: winner.usernameKey,
        winnerName: winner.name,
        winnerPhone: winner.phone,
        entryCount: entries.length,
        pickedBy,
        pickedAtMs: Date.now()
      };

      store.results.push(result);
      saveLuckyDrawStore(store);

      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          result
        }),
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
