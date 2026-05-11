// AZOBSS Render Backend Server
// Supports: website hosting + affiliate online sync + JUPEM PA hold system

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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

```
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
```

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

v = v.replace(/.TIF$/i, "");
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

```
const parsed = url.parse(req.url, true);
const pathname = parsed.pathname || "/";

if (req.method === "OPTIONS") {
  return send(res, 204, "");
}

if (
  pathname === "/api/pa" &&
  req.method === "GET"
) {

  const noPA =
    cleanPA(parsed.query.noPA);

  const negeri =
    cleanState(parsed.query.negeri);

  fs.mkdirSync(
    TEMP_DIR,
    { recursive: true }
  );

  const fileName =
    `${noPA}.TIF`;

  const jupemUrl =
```

`https://ebiz.jupem.gov.my/MuatTurunPembelian/MuatTurunPelanAkui?noPa=${encodeURIComponent(fileName)}&negeri=${encodeURIComponent(negeri)}`;

```
  const response =
    await fetch(jupemUrl);

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  // FIXED FILENAME
  const tempName =
```

`${noPA}.tif`;

```
  const tempPath =
    path.join(
      TEMP_DIR,
      tempName
    );

  fs.writeFileSync(
    tempPath,
    buffer
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
```

} catch (err) {

```
return send(
  res,
  500,
  JSON.stringify({
    ok: false,
    error: err.message
  }),
  "application/json"
);
```

}
}

http.createServer(handler)
.listen(PORT, "0.0.0.0");
