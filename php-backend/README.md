# PHP Backend Files

Folder ini boleh disimpan dalam GitHub sebagai source code, tetapi GitHub Pages tidak akan menjalankan PHP.

Untuk guna fungsi PHP sebenar:

1. Upload fail dalam folder ini ke hosting yang menyokong PHP.
2. Pastikan hosting ada extension `cURL`.
3. Untuk convert TIF ke PDF, pastikan hosting ada extension `Imagick`.
4. Letakkan fail PHP dalam folder yang sama dengan `index.html`, atau ubah URL dalam JavaScript supaya menunjuk ke lokasi PHP sebenar.

Fail:

- `download-pa-pdf.php` - muat turun TIF dari JUPEM dan convert kepada PDF.
- `traffic.php` - kira live visitor dan total visit menggunakan fail JSON pada server PHP.

Nota:

- GitHub Pages hanya support HTML, CSS, JavaScript, JSON, dan asset statik.
- Fail PHP boleh dilihat/disimpan dalam GitHub, tetapi tidak akan diproses sebagai backend.
