<?php
header('Content-Type: application/json; charset=utf-8');

$noPa = isset($_GET['noPa']) ? preg_replace('/[^0-9]/', '', $_GET['noPa']) : '';
$negeri = isset($_GET['negeri']) ? trim($_GET['negeri']) : '';

if ($noPa === '' || $negeri === '') {
    http_response_code(400);
    echo json_encode([
        'exists' => false,
        'message' => 'Sila isi nombor PA dan negeri.'
    ]);
    exit;
}

$url = 'https://ebiz.jupem.gov.my/MuatTurunPembelian/MuatTurunPelanAkui?noPa=PA'
    . rawurlencode($noPa)
    . '.TIF&negeri='
    . rawurlencode($negeri);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_USERAGENT => 'AZOBSS PA Checker'
]);

$body = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$curlError = curl_error($ch);
curl_close($ch);

if ($body === false) {
    http_response_code(502);
    echo json_encode([
        'exists' => false,
        'message' => 'Semakan JUPEM gagal.',
        'error' => $curlError
    ]);
    exit;
}

$errorPatterns = [
    'An error occurred while processing your request',
    'Error Log No.',
    '<h1>Error</h1>',
    'Error'
];

$hasErrorPage = false;
foreach ($errorPatterns as $pattern) {
    if (stripos($body, $pattern) !== false) {
        $hasErrorPage = true;
        break;
    }
}

$looksLikeFile = stripos((string) $contentType, 'image') !== false
    || stripos((string) $contentType, 'tif') !== false
    || stripos((string) $contentType, 'octet-stream') !== false;

$exists = $statusCode >= 200
    && $statusCode < 400
    && !$hasErrorPage
    && ($looksLikeFile || strlen($body) > 0);

echo json_encode([
    'exists' => $exists,
    'url' => $exists ? $url : null,
    'message' => $exists
        ? 'Nombor PA dijumpai.'
        : 'Nombor PA ini tiada dalam sistem atau belum tersedia untuk dimuat turun.'
]);
