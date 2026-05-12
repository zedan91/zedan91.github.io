# AZOBSS Website

Website statik untuk AZOBSS: PC service, PA downloader, affiliate products, software tools, dokumentasi, dan AutoCAD LISP.

## Struktur

- `index.html` - laman utama.
- `affiliate-products.json` - source utama untuk kad affiliate.
- `deploy-server.js` - local/backend server untuk PA downloader dan local affiliate deploy.
- `docs/` - dokumentasi ringkas.
- `tools/` - tools statik.
- `Software Tools/` - download tools Windows.
- `firestore.rules` - Firebase Firestore security rules.

## Run Local Server

```bash
npm install
npm start
```

Server local berjalan di `http://127.0.0.1:3000` secara default. Button `Deploy to GitHub` dalam admin affiliate panel akan panggil:

- `GET http://127.0.0.1:3000/health`
- `POST http://127.0.0.1:3000/deploy`

Endpoint write ini hanya menerima request dari localhost.

## Affiliate Deploy Flow

1. Login sebagai admin `zedan91`.
2. Edit affiliate products dalam laman.
3. Jalankan `npm start` di folder repo.
4. Klik `Deploy to GitHub`.

Server akan validate produk, tulis `affiliate-products.json`, simpan `affiliate-backup.json` local, commit `affiliate-products.json`, dan `git push`.

`affiliate-backup.json`, `*.zip`, dan `temp/` tidak ditrack oleh Git.

## Render.com Backend

Render masih sesuai digunakan untuk backend public yang dipanggil oleh website:

- `GET /api/pa`
- `GET /api/check-pa`
- `POST /api/pa-cart-zip`
- `GET /api/pa-pdf`
- `GET /api/download-pa/...`

Tetapan Render:

- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Node

Render akan guna `process.env.PORT` secara automatik, dan server listen pada `0.0.0.0`.

Endpoint `/deploy` dan `/api/save-affiliates` sengaja dikunci untuk localhost sahaja. Gunakan endpoint itu dari komputer admin untuk update `affiliate-products.json`, commit, dan push ke GitHub. Jangan guna Render untuk flow local deploy affiliate.

## Firebase Rules

Rules berada di `firestore.rules` dan dikonfigurasi oleh `firebase.json`.

Deploy rules:

```bash
npm run deploy:rules
```

Rules menggunakan email auth internal seperti `zedan91@azobss.local` untuk admin dan `{username}@azobss.local` untuk user biasa.

## GitHub Pages

Fail statik boleh terus digunakan di GitHub Pages. Backend Node seperti PA downloader dan local deploy server perlu berjalan di hosting Node atau di komputer sendiri.
