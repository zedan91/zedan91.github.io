<?php
if (!extension_loaded('imagick')) {
    http_response_code(500);
    echo 'PDF conversion requires the PHP Imagick extension.';
    exit;
}

$noPa = isset($_GET['noPa']) ? preg_replace('/[^0-9]/', '', $_GET['noPa']) : '';
$negeri = isset($_GET['negeri']) ? trim($_GET['negeri']) : '';

if ($noPa === '' || $negeri === '') {
    http_response_code(400);
    echo 'Sila isi nombor PA dan negeri.';
    exit;
}

$tifUrl = 'https://ebiz.jupem.gov.my/MuatTurunPembelian/MuatTurunPelanAkui?noPa=PA'
    . rawurlencode($noPa)
    . '.TIF&negeri='
    . rawurlencode($negeri);

$ch = curl_init($tifUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_USERAGENT => 'AZOBSS PA PDF Converter'
]);

$tifData = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($tifData === false || $statusCode < 200 || $statusCode >= 400) {
    http_response_code(502);
    echo 'Nombor PA ini tiada dalam sistem atau belum tersedia untuk dimuat turun.';
    exit;
}

if (
    stripos($tifData, 'An error occurred while processing your request') !== false
    || stripos($tifData, 'Error Log No.') !== false
    || stripos($tifData, '<h1>Error</h1>') !== false
) {
    http_response_code(404);
    echo 'Nombor PA ini tiada dalam sistem atau belum tersedia untuk dimuat turun.';
    exit;
}

try {
    $image = new Imagick();
    $image->readImageBlob($tifData);
    $image->setImageFormat('pdf');

    foreach ($image as $page) {
        $page->setImageFormat('pdf');
        $page->setImageCompressionQuality(90);
    }

    $pdfData = $image->getImagesBlob();
    $image->clear();
    $image->destroy();
} catch (Exception $exception) {
    http_response_code(500);
    echo 'Fail TIF tidak dapat ditukar kepada PDF.';
    exit;
}

$fileName = 'PA' . $noPa . '.pdf';

header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="' . $fileName . '"');
header('Content-Length: ' . strlen($pdfData));
echo $pdfData;
