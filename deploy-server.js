// AZOBSS Local HTTPS Deploy Server
// Letak file ini dalam folder website: www.zedan91.github.io
// Run guna start-azobss-server.bat

const fs = require("fs");
const path = require("path");
const https = require("https");
const url = require("url");

const PORT = 7821;
const ROOT = process.cwd();
const CERT_DIR = path.join(ROOT, ".cert");
const KEY_PATH = path.join(CERT_DIR, "selfsigned.key");
const CERT_PATH = path.join(CERT_DIR, "selfsigned.crt");
const AFFILIATE_JSON = path.join(ROOT, "affiliate-products.json");

function log(msg) {
  const now = new Date().toLocaleTimeString("ms-MY", { hour12: false });
  console.log(`[${now}] ${msg}`);
}

function ensureCert() {
  fs.mkdirSync(CERT_DIR, { recursive: true });

  const hasKey = fs.existsSync(KEY_PATH);
  const hasCert = fs.existsSync(CERT_PATH);

  if (hasKey && hasCert) {
    log("selfsigned jumpa di: .cert");
    return {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
    };
  }

  log("Jana self-signed certificate...");

  let selfsigned;
  try {
    selfsigned = require("selfsigned");
  } catch (err) {
    console.error("[ERROR] Pakej selfsigned belum install.");
    console.error("Run: npm install selfsigned");
    process.exit(1);
  }

  const attrs = [
    { name: "commonName", value: "127.0.0.1" },
    { name: "organizationName", value: "AZOBSS Local Server" },
  ];

  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "basicConstraints",
        cA: true,
      },
      {
        name: "keyUsage",
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true,
      },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  });

  if (!pems || typeof pems.private !== "string" || typeof pems.cert !== "string") {
    console.error("[ERROR] selfsigned gagal generate certificate.");
    console.error("pems.private atau pems.cert kosong/undefined.");
    process.exit(1);
  }

  fs.writeFileSync(KEY_PATH, pems.private, "utf8");
  fs.writeFileSync(CERT_PATH, pems.cert, "utf8");

  log("selfsigned berjaya dibuat di: .cert");

  return {
    key: pems.private,
    cert: pems.cert,
  };
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Body terlalu besar"));
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
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8",
  };
  return types[ext] || "application/octet-stream";
}

function safePath(requestPath) {
  let cleanPath = decodeURIComponent(requestPath.split("?")[0]);

  if (cleanPath === "/") cleanPath = "/index.html";

  const resolved = path.normalize(path.join(ROOT, cleanPath));

  if (!resolved.startsWith(ROOT)) {
    return null;
  }

  return resolved;
}

async function handler(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname || "/";

    if (req.method === "OPTIONS") {
      return send(res, 204, "");
    }

    if (pathname === "/health") {
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          server: "AZOBSS Deploy Server",
          root: ROOT,
          affiliate_json_exists: fs.existsSync(AFFILIATE_JSON),
          time: new Date().toISOString(),
        }, null, 2),
        "application/json; charset=utf-8"
      );
    }

    if (pathname === "/api/affiliates" && req.method === "GET") {
      if (!fs.existsSync(AFFILIATE_JSON)) {
        fs.writeFileSync(AFFILIATE_JSON, "[]", "utf8");
      }
      return send(res, 200, fs.readFileSync(AFFILIATE_JSON, "utf8"), "application/json; charset=utf-8");
    }

    if (pathname === "/api/save-affiliates" && req.method === "POST") {
      const body = await readBody(req);
      let data;

      try {
        data = JSON.parse(body);
      } catch (err) {
        return send(res, 400, JSON.stringify({ ok: false, error: "JSON tidak valid" }), "application/json; charset=utf-8");
      }

      if (!Array.isArray(data)) {
        return send(res, 400, JSON.stringify({ ok: false, error: "Data mesti array affiliate products" }), "application/json; charset=utf-8");
      }

      fs.writeFileSync(AFFILIATE_JSON, JSON.stringify(data, null, 2), "utf8");

      log("affiliate-products.json dikemaskini");

      return send(res, 200, JSON.stringify({ ok: true, saved: data.length }), "application/json; charset=utf-8");
    }

    const filePath = safePath(pathname);

    if (!filePath) {
      return send(res, 403, "Forbidden");
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return send(res, 404, "File not found");
    }

    const data = fs.readFileSync(filePath);
    return send(res, 200, data, mimeType(filePath));

  } catch (err) {
    console.error(err);
    return send(res, 500, "Server error: " + err.message);
  }
}

const credentials = ensureCert();

https.createServer(credentials, handler).listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("============================================");
  console.log(" AZOBSS Deploy Server READY");
  console.log("============================================");
  console.log(`URL: https://127.0.0.1:${PORT}`);
  console.log(`Health: https://127.0.0.1:${PORT}/health`);
  console.log(`Folder: ${ROOT}`);
  console.log("============================================");
  console.log("");
});
