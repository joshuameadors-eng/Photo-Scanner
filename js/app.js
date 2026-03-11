/**
 * Serial Scanner – Main Application Logic (v4: Fully Local Storage)
 */

(function () {
    'use strict';

    const STORAGE_KEY       = 'scannedSerials';
    const SCAN_INTERVAL     = 1000;
    const CONFIDENCE_LOW    = 60;
    const MIN_SERIAL_LEN    = 3;
    const STABLE_HITS       = 2;

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
    const actionButtons     = document.getElementById('action-buttons');
    const recentList        = document.getElementById('recent-list');
    const themeToggle       = document.getElementById('theme-toggle');
    const duplicateModal    = document.getElementById('duplicate-modal');
    const modalSerial       = document.getElementById('modal-serial');
    const modalBtnDupe      = document.getElementById('modal-btn-duplicate');
    const modalBtnCancel    = document.getElementById('modal-btn-cancel');

    let sessionScans   = [];
    let pendingSerial  = '';
    let isProcessing   = false;
    let scanTimer      = null;
    let ocrWorker      = null;
    let cameraStream   = null;
    let scanningPaused = false;
    let lastDetected   = '';
    let stableCount    = 0;
    let autoSaving     = false;

    function show(el) { if (el) { el.classList.add('visible'); el.style.display = ''; } }
    function hide(el) { if (el) { el.classList.remove('visible'); el.style.display = 'none'; } }
    function showFlex(el) { if (el) { el.classList.add('visible'); el.style.display = 'flex'; } }

    function hideAllAlerts() {
        hide(alertLowConf); hide(alertUnreadable); hide(alertSuccess); hide(alertDupeInline);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getStoredScans() {
        try {
            const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch {
            return [];
        }
    }

    function setStoredScans(rows) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    }

    function checkDuplicateLocal(serial) {
        return getStoredScans().some(r => r.serial === serial);
    }

    function saveSerialLocal(serial) {
        const rows = getStoredScans();
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        rows.push({ serial, timestamp });
        setStoredScans(rows);
        return { success: true, timestamp };
    }

    function addToRecentList(serial) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        sessionScans.unshift({ serial, time: timeStr });
        recentList.innerHTML = '';
        sessionScans.forEach(scan => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="recent-serial">${escapeHtml(scan.serial)}</span><span class="recent-time">${scan.time}</span>`;
            recentList.appendChild(li);
        });
    }

    function extractSerial(rawText) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        let bestLine = '';
        let bestScore = 0;
        for (const line of lines) {
            const alphaNum = line.replace(/[^a-zA-Z0-9]/g, '').length;
            if (alphaNum > bestScore) { bestScore = alphaNum; bestLine = line; }
        }
        const result = bestLine || rawText.trim();
        const cleanLen = result.replace(/[^a-zA-Z0-9]/g, '').length;
        return { text: result, isValid: cleanLen >= MIN_SERIAL_LEN };
    }

    function applyTheme(theme) {
        document.documentElement.classList.remove('dark-theme', 'light-theme');
        if (theme === 'dark') {
            document.documentElement.classList.add('dark-theme');
            if (themeToggle) themeToggle.textContent = '☀️';
        } else if (theme === 'light') {
            document.documentElement.classList.add('light-theme');
            if (themeToggle) themeToggle.textContent = '🌙';
        }
    }

    function toggleTheme() {
        const dark = document.documentElement.classList.contains('dark-theme');
        localStorage.setItem('theme', dark ? 'light' : 'dark');
        applyTheme(dark ? 'light' : 'dark');
    }

    async function startCamera() {
        viewfinderWrapper.style.display = '';
        cameraError.style.display = 'none';
        viewfinderStatus.textContent = 'Starting camera…';
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });
            video.srcObject = cameraStream;
            await video.play();
            viewfinderStatus.textContent = 'Scanning…';
            scanRegion.classList.add('scanning');
            return true;
        } catch (err) {
            viewfinderWrapper.style.display = 'none';
            cameraError.style.display = 'flex';
            cameraErrorMsg.textContent = err.name === 'NotAllowedError'
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

    async function initWorker() {
        show(progressSection);
        progressLabel.textContent = 'Loading OCR engine…';
        progressBar.style.width = '0%';
        try {
            ocrWorker = await Tesseract.createWorker('eng', 1, {
                logger: (m) => {
                    if (m.status.includes('loading') || m.status.includes('initializing')) {
                        progressLabel.textContent = m.status + '…';
                        progressBar.style.width = Math.round(m.progress * 100) + '%';
                    }
                },
            });
            hide(progressSection);
            return true;
        } catch {
            progressLabel.textContent = 'OCR engine failed to load.';
            return false;
        }
    }

    function grabFrame() {
        if (!video.videoWidth) return null;
        const fullW = video.videoWidth;
        const fullH = video.videoHeight;
        const sx = Math.round(fullW * 0.10);
        const sy = Math.round(fullH * 0.30);
        const sw = Math.round(fullW * 0.80);
        const sh = Math.round(fullH * 0.40);
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
            const { text: serial, isValid } = extractSerial((data.text || '').trim());
            const confidence = data.confidence || 0;

            if (isValid && serial) {
                if (serial === lastDetected) stableCount++; else { lastDetected = serial; stableCount = 1; }
                viewfinderStatus.textContent = `Reading: ${serial} (${Math.round(confidence)}%)`;
                if (stableCount >= STABLE_HITS) await presentResult(serial, confidence);
            } else {
                lastDetected = '';
                stableCount = 0;
                viewfinderStatus.textContent = 'Scanning…';
            }
        } catch {}

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

    async function presentResult(serial, confidence) {
        scanningPaused = true;
        stopScanLoop();
        scanRegion.classList.remove('scanning');
        scanRegion.classList.add('detected');
        viewfinderStatus.textContent = '✅ Detected!';

        pendingSerial = serial;
        hideAllAlerts();
        show(resultSection);
        detectedSerial.textContent = serial;

        if (checkDuplicateLocal(serial)) {
            showFlex(alertDupeInline);
            restoreActionButtons();
            const saveBtn = actionButtons.querySelector('#btn-save');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save to CSV'; }
            return;
        }

        if (confidence < CONFIDENCE_LOW) {
            showFlex(alertLowConf);
            show(overrideSection);
            overrideInput.value = serial;
        } else {
            hide(overrideSection);
        }

        restoreActionButtons();
        if (!autoSaving) { autoSaving = true; await handleSave(); autoSaving = false; }
    }

    function resetAndResume() {
        hideAllAlerts();
        hide(resultSection);
        hide(overrideSection);
        hide(duplicateModal);
        detectedSerial.textContent = '';
        overrideInput.value = '';
        pendingSerial = '';
        startScanLoop();
    }

    function getSerialValue() {
        const override = overrideInput.value.trim();
        return override || pendingSerial;
    }

    async function handleSave() {
        const serial = getSerialValue();
        if (!serial) { showFlex(alertUnreadable); return; }

        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner"></span> Checking…'; }

        if (checkDuplicateLocal(serial)) {
            modalSerial.textContent = serial;
            show(duplicateModal);
            if (saveBtn) { saveBtn.innerHTML = 'Save to CSV'; saveBtn.disabled = false; }
            return;
        }

        await performSave(serial);
    }

    async function performSave(serial) {
        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner"></span> Saving…'; }

        const result = saveSerialLocal(serial);
        if (result.success) {
            hideAllAlerts();
            hide(overrideSection);
            alertSuccessText.textContent = `"${serial}" saved locally!`;
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
            if (saveBtn) { saveBtn.innerHTML = 'Save to CSV'; saveBtn.disabled = false; }
            const span = alertUnreadable.querySelector('span:last-child');
            if (span) span.textContent = `Failed to save locally. Error: ${result.error || 'Unknown error'}`;
            showFlex(alertUnreadable);
        }
    }

    async function processImageFile(imageSource) {
        scanningPaused = true;
        stopScanLoop();
        if (!ocrWorker) { const ok = await initWorker(); if (!ok) return; }

        show(progressSection);
        progressLabel.textContent = 'Recognizing…';
        progressBar.style.width = '50%';

        try {
            const { data } = await ocrWorker.recognize(imageSource);
            hide(progressSection);
            const { text: serial, isValid } = extractSerial((data.text || '').trim());
            const confidence = data.confidence || 0;
            if (isValid && serial) {
                await presentResult(serial, confidence);
            } else {
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
        } catch {
            hide(progressSection);
            show(resultSection);
            showFlex(alertUnreadable);
            show(overrideSection);
            detectedSerial.textContent = '(OCR failed)';
            overrideInput.focus();
            restoreActionButtons();
        }
    }

    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (btnRetryCamera) btnRetryCamera.addEventListener('click', async () => { const ok = await startCamera(); if (ok) startScanLoop(); });
    if (fileInput) fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => processImageFile(ev.target.result);
        reader.readAsDataURL(file);
    });
    if (overrideInput) overrideInput.addEventListener('input', () => {
        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) saveBtn.disabled = overrideInput.value.trim() === '' && !pendingSerial;
    });
    if (modalBtnDupe) modalBtnDupe.addEventListener('click', async () => {
        hide(duplicateModal);
        await performSave(getSerialValue());
    });
    if (modalBtnCancel) modalBtnCancel.addEventListener('click', () => {
        hide(duplicateModal);
        const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
        if (saveBtn) { saveBtn.innerHTML = 'Save to CSV'; saveBtn.disabled = false; }
    });
    if (duplicateModal) duplicateModal.addEventListener('click', (e) => {
        if (e.target === duplicateModal) {
            hide(duplicateModal);
            const saveBtn = actionButtons.querySelector('#btn-save') || actionButtons.querySelector('.btn-success');
            if (saveBtn) { saveBtn.innerHTML = 'Save to CSV'; saveBtn.disabled = false; }
        }
    });

    async function init() {
        applyTheme(localStorage.getItem('theme'));
        const workerReady = await initWorker();
        if (!workerReady) return;
        const cameraReady = await startCamera();
        if (cameraReady) startScanLoop();
    }

    window.addEventListener('beforeunload', () => {
        stopScanLoop();
        stopCamera();
    });

    init();
})();
