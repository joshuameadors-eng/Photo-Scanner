/**
 * Serial Scanner – Main Application Logic (v2: Live Camera + Dark Mode)
 *
 * Features:
 *   1. Live camera viewfinder via getUserMedia
 *   2. Continuous OCR every ~1 s via persistent Tesseract worker
 *   3. Fixed confidence logic: valid text + low confidence → warn (not block)
 *   4. Only truly empty / garbage output → unreadable
 *   5. Auto duplicate check when serial detected
 *   6. Dark / light theme toggle with localStorage persistence
 *   7. Fallback to file input if camera unavailable
 */

(function () {
    'use strict';

    // ─── Configuration ──────────────────────────────────────
    const API_URL           = 'api.php';
    const SCAN_INTERVAL     = 1000;  // ms between OCR scans
    const CONFIDENCE_LOW    = 60;    // Below → warning, still allow save
    const MIN_SERIAL_LEN    = 3;     // Minimum alphanumeric chars to count as valid
    const STABLE_HITS       = 2;     // How many identical reads before we accept

    // ─── DOM References ─────────────────────────────────────
    const video             = document.getElementById('camera-video');
    const canvas            = document.getElementById('camera-canvas');
    const ctx               = canvas.getContext('2d');
    const viewfinderWrapper = document.getElementById('viewfinder-wrapper');
    const scanRegion        = document.getElementById('scan-region');
    const viewfinderStatus  = document.getElementById('viewfinder-status');
    const cameraError       = document.getElementById('camera-error');
    const cameraErrorMsg    = document.getElementById('camera-error-msg');
    const btnRetryCamera    = document.getElementById('btn-retry-camera');
    const fileInput         = document.getElementById('file-input');
    const progressSection   = document.getElementById('progress-section');
    const progressBar       = document.getElementById('progress-bar');
    const progressLabel     = document.getElementById('progress-label');
    const resultSection     = document.getElementById('result-section');
    const detectedSerial    = document.getElementById('detected-serial');
    const alertLowConf      = document.getElementById('alert-low-confidence');
    const alertUnreadable   = document.getElementById('alert-unreadable');
    const alertDupeInline   = document.getElementById('alert-duplicate-inline');
    const alertSuccess      = document.getElementById('alert-success');
    const alertSuccessText  = document.getElementById('alert-success-text');
    const overrideSection   = document.getElementById('override-section');
    const overrideInput     = document.getElementById('override-input');
    const btnSave           = document.getElementById('btn-save');
    const btnReset          = document.getElementById('btn-reset');
    const actionButtons     = document.getElementById('action-buttons');
    const recentList        = document.getElementById('recent-list');
    const themeToggle       = document.getElementById('theme-toggle');

    // Duplicate modal
    const duplicateModal    = document.getElementById('duplicate-modal');
    const modalSerial       = document.getElementById('modal-serial');
    const modalBtnDupe      = document.getElementById('modal-btn-duplicate');
    const modalBtnCancel    = document.getElementById('modal-btn-cancel');

    // ─── State ──────────────────────────────────────────────
    let sessionScans   = [];
    let pendingSerial  = '';
    let ocrConfidence  = 0;
    let isProcessing   = false;
    let scanTimer      = null;
    let ocrWorker      = null;
    let cameraStream   = null;
    let scanningPaused = false;
    let lastDetected   = '';
    let stableCount    = 0;
    let isDuplicate    = false;

    // ─── Helpers ────────────────────────────────────────────

    function show(el)  { if (el) { el.classList.add('visible'); el.style.display = ''; } }
    function hide(el)  { if (el) { el.classList.remove('visible'); el.style.display = 'none'; } }
    function showFlex(el) { if (el) { el.classList.add('visible'); el.style.display = 'flex'; } }

    function hideAllAlerts() {
        hide(alertLowConf);
        hide(alertUnreadable);
        hide(alertSuccess);
        hide(alertDupeInline);
    }

    function getSerialValue() {
        const override = overrideInput.value.trim();
        return override || pendingSerial;
    }

    function addToRecentList(serial) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        sessionScans.unshift({ serial, time: timeStr });

        recentList.innerHTML = '';
        sessionScans.forEach(scan => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="recent-serial">${escapeHtml(scan.serial)}</span><span class="recent-time">${scan.time}</span>`;
            recentList.appendChild(li);
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Extract the best serial-like line from raw OCR text.
     * Returns { text, isValid }
     */
    function extractSerial(rawText) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let bestLine = '';
        let bestScore = 0;

        for (const line of lines) {
            const alphaNum = line.replace(/[^a-zA-Z0-9]/g, '').length;
            if (alphaNum > bestScore) {
                bestScore = alphaNum;
                bestLine = line;
            }
        }

        const result = bestLine || rawText.trim();
        const cleanLen = result.replace(/[^a-zA-Z0-9]/g, '').length;
        return { text: result, isValid: cleanLen >= MIN_SERIAL_LEN };
    }

    // ─── Theme Toggle ───────────────────────────────────────

    function applyTheme(theme) {
        document.documentElement.classList.remove('dark-theme', 'light-theme');
        if (theme === 'dark') {
            document.documentElement.classList.add('dark-theme');
            if (themeToggle) themeToggle.textContent = '☀️';
        } else if (theme === 'light') {
            document.documentElement.classList.add('light-theme');
            if (themeToggle) themeToggle.textContent = '🌙';
        } else {
            if (themeToggle) {
                const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                themeToggle.textContent = isDark ? '☀️' : '🌙';
            }
        }
    }

    function toggleTheme() {
        const root = document.documentElement;
        if (root.classList.contains('dark-theme')) {
            localStorage.setItem('theme', 'light');
            applyTheme('light');
        } else {
            localStorage.setItem('theme', 'dark');
            applyTheme('dark');
        }
    }

    // ─── Camera ─────────────────────────────────────────────

    async function startCamera() {
        viewfinderWrapper.style.display = '';
        cameraError.style.display = 'none';
        viewfinderStatus.textContent = 'Starting camera…';

        try {
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width:  { ideal: 1280 },
                    height: { ideal: 720 },
                },
                audio: false,
            };
            cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = cameraStream;
            await video.play();
            viewfinderStatus.textContent = 'Scanning…';
            scanRegion.classList.add('scanning');
            return true;
        } catch (err) {
            console.error('Camera error:', err);
            viewfinderWrapper.style.display = 'none';
            cameraError.style.display = 'flex';
            cameraErrorMsg.textContent =
                err.name === 'NotAllowedError'
                    ? 'Camera access denied. Please allow camera permissions and retry.'
                    : 'Unable to access camera: ' + err.message;
            return false;
        }
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }
    }

    // ─── OCR Worker ─────────────────────────────────────────

    async function initWorker() {
        show(progressSection);
        progressLabel.textContent = 'Loading OCR engine…';
        progressBar.style.width = '0%';

        try {
            ocrWorker = await Tesseract.createWorker('eng', 1, {
                logger: (m) => {
                    if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract' || m.status === 'loading language traineddata') {
                        progressLabel.textContent = m.status + '…';
                        progressBar.style.width = Math.round(m.progress * 100) + '%';
                    }
                },
            });
            hide(progressSection);
            return true;
        } catch (err) {
            console.error('OCR init failed:', err);
            progressLabel.textContent = 'OCR engine failed to load.';
            return false;
        }
    }

    // ─── Live Scan Loop ─────────────────────────────────────

    function grabFrame() {
        if (!video.videoWidth) return null;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Crop to the scan region area (central 80% × 40%)
        const sx = Math.round(canvas.width * 0.10);
        const sy = Math.round(canvas.height * 0.30);
        const sw = Math.round(canvas.width * 0.80);
        const sh = Math.round(canvas.height * 0.40);

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        canvas.width = sw;
        canvas.height = sh;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

        return canvas;
    }

    async function scanFrame() {
        if (isProcessing || scanningPaused || !ocrWorker) return;
        isProcessing = true;

        const frame = grabFrame();
        if (!frame) { isProcessing = false; return; }

        try {
            const { data } = await ocrWorker.recognize(frame);
            const raw = data.text.trim();
            const confidence = data.confidence;
            const { text: serial, isValid } = extractSerial(raw);

            if (isValid && serial) {
                // Stability check: same serial read N times in a row
                if (serial === lastDetected) {
                    stableCount++;
                } else {
                    lastDetected = serial;
                    stableCount = 1;
                }

                viewfinderStatus.textContent = `Reading: ${serial} (${Math.round(confidence)}%)`;

                if (stableCount >= STABLE_HITS) {
                    // Accept this serial — pause scanning and show result
                    await presentResult(serial, confidence);
                }
            } else {
                lastDetected = '';
                stableCount = 0;
                viewfinderStatus.textContent = 'Scanning…';
            }
        } catch (err) {
            console.error('Scan error:', err);
        }

        isProcessing = false;
    }

    function startScanLoop() {
        stopScanLoop();
        scanningPaused = false;
        lastDetected = '';
        stableCount = 0;
        scanRegion.classList.add('scanning');
        scanRegion.classList.remove('detected');
        viewfinderStatus.textContent = 'Scanning…';
        scanTimer = setInterval(scanFrame, SCAN_INTERVAL);
    }

    function stopScanLoop() {
        if (scanTimer) {
            clearInterval(scanTimer);
            scanTimer = null;
        }
    }

    // ─── Present Result ─────────────────────────────────────

    async function presentResult(serial, confidence) {
        scanningPaused = true;
        stopScanLoop();
        scanRegion.classList.remove('scanning');
        scanRegion.classList.add('detected');
        viewfinderStatus.textContent = '✅ Detected!';

        pendingSerial = serial;
        ocrConfidence = confidence;
        isDuplicate = false;

        hideAllAlerts();
        show(resultSection);
        detectedSerial.textContent = serial;

        // Auto-check duplicate
        isDuplicate = await checkDuplicate(serial);

        if (isDuplicate) {
            showFlex(alertDupeInline);
        }

        // Confidence evaluation — fixed logic:
        // If we have valid text, always allow saving. Only warn, never block.
        if (confidence < CONFIDENCE_LOW) {
            showFlex(alertLowConf);
            show(overrideSection);
            overrideInput.value = serial;
        } else {
            hide(overrideSection);
        }

        btnSave.disabled = false;
        btnSave.innerHTML = 'Save to CSV';

        // Restore action buttons if they were replaced by "Scan Another"
        restoreActionButtons();
    }

    function restoreActionButtons() {
        actionButtons.innerHTML = '';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-success';
        saveBtn.id = 'btn-save';
        saveBtn.textContent = 'Save to CSV';
        saveBtn.addEventListener('click', handleSave);

        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn btn-outline';
        resetBtn.id = 'btn-reset';
        resetBtn.textContent = 'Resume Scanning';
        resetBtn.addEventListener('click', resetAndResume);

        actionButtons.appendChild(saveBtn);
        actionButtons.appendChild(resetBtn);
    }

    // ─── Reset & Resume ─────────────────────────────────────

    function resetAndResume() {
        hideAllAlerts();
        hide(resultSection);
        hide(overrideSection);
        hide(duplicateModal);
        detectedSerial.textContent = '';
        overrideInput.value = '';
        pendingSerial = '';
        ocrConfidence = 0;
        isDuplicate = false;
        startScanLoop();
    }

    // ─── API Calls ──────────────────────────────────────────

    async function checkDuplicate(serial) {
        try {
            const resp = await fetch(`${API_URL}?action=check&serial=${encodeURIComponent(serial)}`);
            const json = await resp.json();
            return json.exists === true;
        } catch (err) {
            console.error('Duplicate check failed:', err);
            return false;
        }
    }

    async function saveSerial(serial) {
        try {
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serial }),
            });
            const json = await resp.json();
            return json.success === true;
        } catch (err) {
            console.error('Save failed:', err);
            return false;
        }
    }

    // ─── Save Flow ──────────────────────────────────────────

    async function handleSave() {
        const serial = getSerialValue();
        if (!serial) {
            showFlex(alertUnreadable);
            return;
        }

        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span> Checking…';
        }

        // Re-check duplicate at save time
        const dupeNow = await checkDuplicate(serial);

        if (dupeNow) {
            modalSerial.textContent = serial;
            show(duplicateModal);
            if (saveBtn) {
                saveBtn.innerHTML = 'Save to CSV';
                saveBtn.disabled = false;
            }
            return;
        }

        await performSave(serial);
    }

    async function performSave(serial) {
        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span> Saving…';
        }

        const success = await saveSerial(serial);

        if (success) {
            hideAllAlerts();
            hide(overrideSection);
            alertSuccessText.textContent = `"${serial}" saved to CSV!`;
            showFlex(alertSuccess);
            addToRecentList(serial);

            actionButtons.innerHTML = '';
            const againBtn = document.createElement('button');
            againBtn.className = 'btn btn-primary';
            againBtn.style.width = '100%';
            againBtn.textContent = '📷 Scan Another';
            againBtn.addEventListener('click', resetAndResume);
            actionButtons.appendChild(againBtn);
        } else {
            if (saveBtn) {
                saveBtn.innerHTML = 'Save to CSV';
                saveBtn.disabled = false;
            }
            const span = alertUnreadable.querySelector('span:last-child');
            if (span) span.textContent = 'Failed to save. Please try again.';
            showFlex(alertUnreadable);
        }
    }

    // ─── Fallback: File Input ───────────────────────────────

    async function processImageFile(imageSource) {
        scanningPaused = true;
        stopScanLoop();

        if (!ocrWorker) {
            const ok = await initWorker();
            if (!ok) return;
        }

        show(progressSection);
        progressLabel.textContent = 'Recognizing…';
        progressBar.style.width = '50%';

        try {
            const { data } = await ocrWorker.recognize(imageSource);
            hide(progressSection);

            const raw = data.text.trim();
            const confidence = data.confidence;
            const { text: serial, isValid } = extractSerial(raw);

            if (isValid && serial) {
                await presentResult(serial, confidence);
            } else {
                // Truly unreadable
                show(resultSection);
                detectedSerial.textContent = serial || '(unable to read)';
                showFlex(alertUnreadable);
                show(overrideSection);
                overrideInput.value = '';
                overrideInput.focus();
                restoreActionButtons();
                const saveBtn = actionButtons.querySelector('#btn-save');
                if (saveBtn) saveBtn.disabled = false;
            }
        } catch (err) {
            console.error('OCR Error:', err);
            hide(progressSection);
            show(resultSection);
            showFlex(alertUnreadable);
            show(overrideSection);
            detectedSerial.textContent = '(OCR failed)';
            overrideInput.focus();
            restoreActionButtons();
        }
    }

    // ─── Event Listeners ────────────────────────────────────

    // Theme toggle
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    // Retry camera
    if (btnRetryCamera) btnRetryCamera.addEventListener('click', async () => {
        const ok = await startCamera();
        if (ok) startScanLoop();
    });

    // Fallback file input
    if (fileInput) fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => processImageFile(ev.target.result);
        reader.readAsDataURL(file);
    });

    // Override input
    if (overrideInput) overrideInput.addEventListener('input', () => {
        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) saveBtn.disabled = overrideInput.value.trim() === '' && !pendingSerial;
    });

    // Duplicate modal: add anyway
    if (modalBtnDupe) modalBtnDupe.addEventListener('click', async () => {
        hide(duplicateModal);
        const serial = getSerialValue();
        await performSave(serial);
    });

    // Duplicate modal: cancel
    if (modalBtnCancel) modalBtnCancel.addEventListener('click', () => {
        hide(duplicateModal);
        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) {
            saveBtn.innerHTML = 'Save to CSV';
            saveBtn.disabled = false;
        }
    });

    // Close modal on overlay click
    if (duplicateModal) duplicateModal.addEventListener('click', (e) => {
        if (e.target === duplicateModal) {
            hide(duplicateModal);
            const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
            if (saveBtn) {
                saveBtn.innerHTML = 'Save to CSV';
                saveBtn.disabled = false;
            }
        }
    });

    // ─── Initialization ─────────────────────────────────────

    async function init() {
        applyTheme(localStorage.getItem('theme'));

        const workerReady = await initWorker();
        if (!workerReady) return;

        const cameraReady = await startCamera();
        if (cameraReady) {
            startScanLoop();
        }
    }

    init();

})();
