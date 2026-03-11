<?php
/**
 * Serial Number Scanner API
 * 
 * Endpoints:
 *   GET  ?action=check&serial=XXX  — Check if a serial number already exists
 *   GET  ?action=list               — Return all CSV rows as JSON
 *   POST (serial=XXX)               — Append a new serial number to the master CSV
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

define('CSV_FILE', __DIR__ . '/data/serials.csv');

// Ensure the CSV file exists with headers
if (!file_exists(CSV_FILE)) {
    if (!is_dir(dirname(CSV_FILE))) {
        mkdir(dirname(CSV_FILE), 0755, true);
    }
    file_put_contents(CSV_FILE, "SerialNumber,Timestamp\n");
}

/**
 * Read all serial numbers from the CSV.
 * Returns an array of associative arrays.
 */
function readSerials(): array {
    $rows = [];
    if (($handle = fopen(CSV_FILE, 'r')) !== false) {
        $header = fgetcsv($handle); // skip header
        while (($data = fgetcsv($handle)) !== false) {
            if (count($data) >= 2 && trim($data[0]) !== '') {
                $rows[] = [
                    'serial'    => $data[0],
                    'timestamp' => $data[1],
                ];
            }
        }
        fclose($handle);
    }
    return $rows;
}

/**
 * Check if an exact-match serial already exists.
 */
function serialExists(string $serial): bool {
    $serials = readSerials();
    foreach ($serials as $row) {
        if ($row['serial'] === $serial) {
            return true;
        }
    }
    return false;
}

/**
 * Append a serial number to the CSV with file locking.
 * Returns ['success' => bool, 'error' => string|null, 'timestamp' => string|null]
 */
function appendSerial(string $serial): array {
    $timestamp = date('Y-m-d H:i:s');
    $dir = dirname(CSV_FILE);

    if (!is_dir($dir)) {
        return [
            'success' => false,
            'error' => 'Data directory does not exist: ' . $dir,
            'timestamp' => null,
        ];
    }

    if (!is_writable($dir)) {
        return [
            'success' => false,
            'error' => 'Data directory is not writable: ' . $dir,
            'timestamp' => null,
        ];
    }

    if (file_exists(CSV_FILE) && !is_writable(CSV_FILE)) {
        return [
            'success' => false,
            'error' => 'CSV file is not writable: ' . CSV_FILE,
            'timestamp' => null,
        ];
    }

    $fp = fopen(CSV_FILE, 'a');
    if ($fp === false) {
        return [
            'success' => false,
            'error' => 'Failed to open CSV file for appending: ' . CSV_FILE,
            'timestamp' => null,
        ];
    }

    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        return [
            'success' => false,
            'error' => 'Failed to acquire file lock for CSV write',
            'timestamp' => null,
        ];
    }

    $writeOk = fputcsv($fp, [$serial, $timestamp]);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    if ($writeOk === false) {
        return [
            'success' => false,
            'error' => 'Failed to write CSV row',
            'timestamp' => null,
        ];
    }

    return [
        'success' => true,
        'error' => null,
        'timestamp' => $timestamp,
    ];
}

// ─── Routing ───────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $action = $_GET['action'] ?? '';

    if ($action === 'check') {
        // Check for duplicate
        $serial = trim($_GET['serial'] ?? '');
        if ($serial === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Missing serial parameter']);
            exit;
        }
        echo json_encode([
            'exists' => serialExists($serial),
            'serial' => $serial,
        ]);
        exit;
    }

    if ($action === 'list') {
        // Return all entries
        $rows = readSerials();
        echo json_encode([
            'count' => count($rows),
            'rows'  => $rows,
        ]);
        exit;
    }

    // Default: unknown action
    http_response_code(400);
    echo json_encode(['error' => 'Unknown action. Use ?action=check&serial=XXX or ?action=list']);
    exit;
}

if ($method === 'POST') {
    // Read JSON or form data
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';

    if (stripos($contentType, 'application/json') !== false) {
        $body   = json_decode(file_get_contents('php://input'), true);
        $serial = trim($body['serial'] ?? '');
    } else {
        $serial = trim($_POST['serial'] ?? '');
    }

    if ($serial === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Missing serial number']);
        exit;
    }

    // Append
    $append = appendSerial($serial);

    if ($append['success'] === true) {
        echo json_encode([
            'success'   => true,
            'serial'    => $serial,
            'timestamp' => $append['timestamp'],
        ]);
    } else {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error'   => $append['error'] ?? 'Failed to write to CSV',
            'debug'   => [
                'csv_path' => CSV_FILE,
                'csv_exists' => file_exists(CSV_FILE),
                'csv_writable' => file_exists(CSV_FILE) ? is_writable(CSV_FILE) : null,
                'dir_path' => dirname(CSV_FILE),
                'dir_writable' => is_writable(dirname(CSV_FILE)),
            ],
        ]);
    }
    exit;
}

// Unsupported method
http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
