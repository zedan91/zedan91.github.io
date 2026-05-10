// AZOBSS Render / Local HTTP Deploy Server
// Sesuai untuk Render Web Service
// Render sudah ada HTTPS automatik

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();

function send(res, status, body, type = "text/plain") {
    res.writeHead(status, {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*"
    });

    res.end(body);
}

function mimeType(file) {

    const ext = path.extname(file).toLowerCase();

    const types = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon"
    };

    return types[ext] || "application/octet-stream";
}

http.createServer((req, res) => {

    let pathname = url.parse(req.url).pathname;

    if (pathname === "/") {
        pathname = "/index.html";
    }

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

    const filePath = path.join(ROOT, pathname);

    if (!fs.existsSync(filePath)) {
        return send(res, 404, "File Not Found");
    }

    try {

        const data = fs.readFileSync(filePath);

        send(
            res,
            200,
            data,
            mimeType(filePath)
        );

    } catch (err) {

        send(
            res,
            500,
            "Server Error: " + err.message
        );

    }

}).listen(PORT, "0.0.0.0", () => {

    console.log("");
    console.log("================================");
    console.log(" AZOBSS BACKEND RUNNING");
    console.log("================================");
    console.log("PORT:", PORT);
    console.log("ROOT:", ROOT);
    console.log("================================");
    console.log("");

});