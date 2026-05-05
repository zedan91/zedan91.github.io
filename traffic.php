<?php
header('Content-Type: application/json; charset=utf-8');

$dataFile = __DIR__ . '/traffic-data.json';
$activeWindow = 90;
$now = time();

$input = json_decode(file_get_contents('php://input'), true);
$visitorId = isset($input['visitorId']) ? preg_replace('/[^a-zA-Z0-9\-_]/', '', $input['visitorId']) : '';

if ($visitorId === '') {
    http_response_code(400);
    echo json_encode([
        'liveVisitors' => 0,
        'totalVisits' => 0,
        'message' => 'Invalid visitor.'
    ]);
    exit;
}

$defaultData = [
    'totalVisits' => 0,
    'visitors' => []
];

$data = $defaultData;

if (file_exists($dataFile)) {
    $existing = json_decode(file_get_contents($dataFile), true);

    if (is_array($existing)) {
        $data = array_merge($defaultData, $existing);
    }
}

if (!isset($data['visitors']) || !is_array($data['visitors'])) {
    $data['visitors'] = [];
}

foreach ($data['visitors'] as $id => $visitor) {
    $lastSeen = isset($visitor['lastSeen']) ? (int) $visitor['lastSeen'] : 0;

    if ($lastSeen < $now - 86400) {
        unset($data['visitors'][$id]);
    }
}

if (!isset($data['visitors'][$visitorId])) {
    $data['totalVisits'] = (int) $data['totalVisits'] + 1;
}

$data['visitors'][$visitorId] = [
    'lastSeen' => $now
];

$liveVisitors = 0;

foreach ($data['visitors'] as $visitor) {
    $lastSeen = isset($visitor['lastSeen']) ? (int) $visitor['lastSeen'] : 0;

    if ($lastSeen >= $now - $activeWindow) {
        $liveVisitors++;
    }
}

file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT), LOCK_EX);

echo json_encode([
    'liveVisitors' => $liveVisitors,
    'totalVisits' => (int) $data['totalVisits']
]);
