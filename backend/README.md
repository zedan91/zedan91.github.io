# AZOBSS Lucky Draw Backend for Render

## Deploy
1. Upload folder `backend` ke GitHub repo baru.
2. Render → New Web Service → connect repo.
3. Build Command: `npm install`
4. Start Command: `npm start`

## Environment Variables
- `ADMIN_KEY` = optional sahaja, versi ini NO PASSWORD MODE
- `PUBLIC_BASE_URL` = URL backend Render, contoh `https://azobss-lucky-draw.onrender.com`
- `CORS_ORIGIN` = `https://azobss.com`
- `TZ` = `Asia/Kuala_Lumpur`

## Frontend
Dalam `website/index.html`, cari:
`window.AZOBSS_LUCKY_DRAW_API`

Tukar URL kepada URL Render sebenar.

## No Password Mode
Versi ini tidak akan minta ADMIN_KEY. Pastikan `CORS_ORIGIN` di Render ditetapkan kepada domain website anda sahaja, contoh `https://azobss.com`.
