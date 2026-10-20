<?php
// Modulo contatti di Pennylog: valida, limita gli invii e inoltra l'email a informazioni@istore-lab.com.
// Nessun servizio esterno, nessun cookie, nessun database. I messaggi non vengono salvati sul server.
declare(strict_types=1);

const TO_ADDR   = 'informazioni@istore-lab.com';
const FROM_ADDR = 'noreply@istore-lab.com';
const MAX_PER_HOUR = 5;

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$isFetch = ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'fetch';
$lang = (($_POST['lang'] ?? 'en') === 'it') ? 'it' : 'en';

function finish(string $status, bool $isFetch, string $lang): void {
    if ($isFetch) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['status' => $status]);
    } else {
        $page = $lang === 'it' ? '/it/contatti.html' : '/contact.html';
        header('Location: ' . $page . '?status=' . $status . '#form', true, 303);
    }
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}

function clean(string $s, int $max): string {
    $s = preg_replace('/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/u', '', $s) ?? '';
    return mb_substr(trim($s), 0, $max);
}
function oneLine(string $s): string {
    return trim(preg_replace('/\\s+/u', ' ', $s) ?? '');
}

// Trappola per i bot: il campo nascosto "website" deve restare vuoto. Si finge successo.
if (($_POST['website'] ?? '') !== '') { finish('ok', $isFetch, $lang); }

// Chi compila in meno di 3 secondi è un bot (il campo ts lo imposta il browser).
$ts = (int)($_POST['ts'] ?? 0);
if ($ts > 0 && (microtime(true) * 1000 - $ts) < 3000) { finish('wait', $isFetch, $lang); }

$name    = oneLine(clean((string)($_POST['name'] ?? ''), 80));
$email   = oneLine(clean((string)($_POST['email'] ?? ''), 120));
$message = clean((string)($_POST['message'] ?? ''), 3000);
$privacy = ($_POST['privacy'] ?? '') === '1';

if ($name === '' || mb_strlen($message) < 10 || !$privacy
    || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[\\r\\n,;<>]/', $email)) {
    finish('invalid', $isFetch, $lang);
}

// Limite di invii per indirizzo IP (conservato solo come hash, nella cartella temporanea).
$key  = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|pennylog');
$file = sys_get_temp_dir() . '/pl_contact_' . $key;
$now  = time();
$hits = [];
if (is_file($file)) {
    $hits = array_values(array_filter(array_map('intval', (array)file($file, FILE_IGNORE_NEW_LINES)), fn($t) => $now - $t < 3600));
}
if (count($hits) >= MAX_PER_HOUR) { finish('wait', $isFetch, $lang); }
$hits[] = $now;
@file_put_contents($file, implode("\n", $hits), LOCK_EX);

$subject = '[Pennylog] ' . mb_substr($name, 0, 60);
$body = "Name: $name\nEmail: $email\nLanguage: $lang\nDate: " . gmdate('Y-m-d H:i') . " UTC\n\n" . $message . "\n";
$headers = [
    'From: Pennylog <' . FROM_ADDR . '>',
    'Reply-To: ' . $email,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: Pennylog contact form',
];
$sent = mail(TO_ADDR, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers), '-f' . FROM_ADDR);
finish($sent ? 'ok' : 'error', $isFetch, $lang);
