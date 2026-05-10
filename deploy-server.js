// AZOBSS Render Backend Server
// Supports: website hosting + affiliate products online sync
// Render provides HTTPS automatically.

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();
const AFFILIATE_JSON = path.join(ROOT, "affiliate-products.json");

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
    ".md": "text/markdown; charset=utf-8"
  };
  return types[ext] || "application/octet-stream";
}

function safePath(requestPath) {
  let cleanPath = decodeURIComponent(requestPath.split("?")[0]);
  if (cleanPath === "/") cleanPath = "/index.html";

  const resolved = path.normalize(path.join(ROOT, cleanPath));
  if (!resolved.startsWith(ROOT)) return null;

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
          server: "AZOBSS Backend Running",
          port: String(PORT),
          affiliate_json_exists: fs.existsSync(AFFILIATE_JSON),
          time: new Date().toISOString()
        }, null, 2),
        "application/json; charset=utf-8"
      );
    }

    if (pathname === "/api/affiliates" && req.method === "GET") {
      if (!fs.existsSync(AFFILIATE_JSON)) {
        fs.writeFileSync(AFFILIATE_JSON, "[]", "utf8");
      }

      return send(
        res,
        200,
        fs.readFileSync(AFFILIATE_JSON, "utf8"),
        "application/json; charset=utf-8"
      );
    }

    if (pathname === "/api/save-affiliates" && req.method === "POST") {
      const body = await readBody(req);
      let data;

      try {
        data = JSON.parse(body);
      } catch (err) {
        return send(
          res,
          400,
          JSON.stringify({ ok: false, error: "Invalid JSON" }),
          "application/json; charset=utf-8"
        );
      }

      if (!Array.isArray(data)) {
        return send(
          res,
          400,
          JSON.stringify({ ok: false, error: "Data must be an array" }),
          "application/json; charset=utf-8"
        );
      }

      fs.writeFileSync(AFFILIATE_JSON, JSON.stringify(data, null, 2), "utf8");

      return send(
        res,
        200,
        JSON.stringify({ ok: true, saved: data.length }),
        "application/json; charset=utf-8"
      );
    }

    const filePath = safePath(pathname);
    if (!filePath) return send(res, 403, "Forbidden");

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return send(res, 404, "File Not Found");
    }

    const data = fs.readFileSync(filePath);
    return send(res, 200, data, mimeType(filePath));

  } catch (err) {
    console.error(err);
    return send(res, 500, "Server Error: " + err.message);
  }
}

http.createServer(handler).listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("================================");
  console.log(" AZOBSS BACKEND RUNNING");
  console.log("================================");
  console.log("PORT:", PORT);
  console.log("ROOT:", ROOT);
  console.log("================================");
  console.log("");
});
