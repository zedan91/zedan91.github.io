# AZOBSS Lucky Draw Backend for Render

## Deploy
1. Upload folder `backend` ke GitHub repo baru.
2. Render → New Web Service → connect repo.
3. Build Command: `npm install`
4. Start Command: `npm start`

## Environment Variables
- `ADMIN_KEY` = password/key admin anda
- `PUBLIC_BASE_URL` = URL backend Render, contoh `https://azobss-lucky-draw.onrender.com`
- `CORS_ORIGIN` = `https://azobss.com`
- `TZ` = `Asia/Kuala_Lumpur`

## Frontend
Dalam `website/index.html`, cari:
`window.AZOBSS_LUCKY_DRAW_API`

Tukar URL kepada URL Render sebenar.
