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

## Firebase Rules

Rules berada di `firestore.rules` dan dikonfigurasi oleh `firebase.json`.

Deploy rules:

```bash
npm run deploy:rules
```

Rules menggunakan email auth internal seperti `zedan91@azobss.local` untuk admin dan `{username}@azobss.local` untuk user biasa.

## GitHub Pages

Fail statik boleh terus digunakan di GitHub Pages. Backend Node seperti PA downloader dan local deploy server perlu berjalan di hosting Node atau di komputer sendiri.
