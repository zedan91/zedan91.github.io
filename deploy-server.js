// AZOBSS Render Backend Server
// Supports: website hosting + affiliate online sync + JUPEM PA hold system

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();

const AFFILIATE_JSON = path.join(ROOT, "affiliate-products.json");
const TEMP_DIR = path.join(ROOT, "temp");

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
        await fetch(jupemUrl);

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
`${Date.now()}-${noPA}-${negeri}.tif`;

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
            `/temp/${tempName}`
        }, null, 2),
        "application/json"
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
        error: err.message
      }),
      "application/json"
    );
  }
}

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