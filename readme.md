# 📷 Serial Number Scanner

A mobile-first web application for scanning serial numbers from photos and saving them to a shared CSV file. Built with PHP, vanilla JavaScript, and [Tesseract.js](https://github.com/naptha/tesseract.js) for client-side OCR.

---

## Features

- **📸 Camera Capture** — Tap to open your device camera and photograph a serial number
- **🔍 Automatic OCR** — Tesseract.js extracts text entirely client-side (no external APIs)
- **⚠️ Blurry/Unreadable Detection** — Warns when confidence is low and requires manual confirmation
- **✏️ Manual Override** — Text input to correct or manually enter serial numbers when OCR fails
- **🚫 Duplicate Detection** — Blocks duplicate entries by default with a prompt to allow or reject
- **📋 Shared Live CSV Viewer** — Anyone with the URL can view the master CSV in real time
- **⬇️ CSV Download** — One-click download of the full CSV from the viewer page
- **🔒 Append-Only** — Entries cannot be edited or deleted, ensuring data integrity
- **📱 Mobile-First Design** — Optimized for phone screens with large touch targets

---

## Project Structure

```
camera scanner/
├── api.php              # PHP backend — duplicate checks, save, list
├── index.html           # Scanner page — camera capture + OCR UI
├── view.html            # Shared live-updating CSV viewer
├── css/
│   └── style.css        # Mobile-first responsive stylesheet
├── js/
│   ├── app.js           # Scanner logic — OCR, validation, save flow
│   └── view.js          # Viewer logic — polling, table render, download
├── data/
│   └── serials.csv      # Master CSV file (append-only)
└── readme.md            # This file
```

---

## Requirements

- **PHP 7.4+** (only the built-in server is needed for local use)
- A modern web browser with camera access (Chrome, Safari, Firefox)
- Internet connection on first load (to fetch Tesseract.js from CDN)

---

## Quick Start

### 1. Start the PHP server

```bash
cd "camera scanner"
php -S 0.0.0.0:8080
```

### 2. Open on your phone

Find your computer's local IP address:

| OS | Command |
|---|---|
| **Windows** | `ipconfig` → look for IPv4 Address |
| **macOS** | `ifconfig en0` → look for `inet` |
| **Linux** | `hostname -I` |

Then open in your phone's browser (same Wi-Fi network):

```
http://<your-computer-ip>:8080
```

### 3. Start scanning

1. Tap **"Tap to Take Photo"** to open your camera
2. Photograph a serial number
3. Review the detected text
4. Tap **"Save to CSV"**

### 4. View the shared CSV

Navigate to the **View CSV** tab (or visit `/view.html`) from any device to see all scanned entries updating live.

---

## How It Works

### OCR & Confidence

| Confidence Level | Behavior |
|---|---|
| **≥ 60%** | ✅ Serial displayed, ready to save |
| **30% – 59%** | ⚠️ Warning shown, manual override input pre-filled for review |
| **< 30%** | ❌ Marked as unreadable, manual entry required |

The app selects the best line from the OCR output by scoring each line on alphanumeric character density.

### Duplicate Detection

Before every save, the app calls the API to check for an **exact match** against all existing entries:

- **If no match** → saves immediately
- **If match found** → a modal blocks the save and asks the user to confirm or cancel

### API Endpoints

| Method | URL | Description |
|---|---|---|
| `GET` | `api.php?action=check&serial=XXX` | Check if a serial number exists (returns `{ exists: true/false }`) |
| `GET` | `api.php?action=list` | List all entries as JSON |
| `POST` | `api.php` | Save a new serial number (body: `{ "serial": "XXX" }`) |

### File Locking

The PHP backend uses `flock(LOCK_EX)` when writing to the CSV to prevent corruption from concurrent saves.

---

## Configuration

Key settings can be adjusted at the top of `js/app.js`:

```javascript
const CONFIDENCE_LOW  = 60;   // Threshold for "low confidence" warning
const CONFIDENCE_FAIL = 30;   // Threshold for "unreadable" state
```

Polling interval for the live viewer can be adjusted in `js/view.js`:

```javascript
const POLL_INTERVAL = 3000;   // Milliseconds between refreshes
```

---

## Tips for Best Results

- **Lighting** — Ensure the serial number is well-lit with minimal shadows
- **Focus** — Hold the phone steady and wait for autofocus before capturing
- **Angle** — Photograph straight-on rather than at an angle
- **Contrast** — Dark text on a light background produces the best OCR results
- **Crop** — Get as close to the serial number as possible to reduce noise

---

## Limitations

- OCR runs entirely in the browser — processing speed depends on the device
- First scan may take a few seconds while Tesseract.js loads its language data (~2 MB)
- No authentication — anyone with the URL can scan and view entries
- Append-only — there is no edit or delete functionality by design

---

## License

This project is provided as-is for internal use. No license restrictions.
