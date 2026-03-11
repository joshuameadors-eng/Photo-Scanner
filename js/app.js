/**
 * Serial Scanner – Main Application Logic
 * 
 * Handles:
 *   1. Image capture from device camera
 *   2. OCR via Tesseract.js with confidence evaluation
 *   3. Low-confidence warnings & manual override
 *   4. Duplicate detection via API before saving
 *   5. Append-only save to master CSV via API
 */

(function () {
    'use strict';

    // ─── Configuration ──────────────────────────────────────
    const API_URL          = 'api.php';
    const CONFIDENCE_LOW   = 60;   // Below this → show warning + require confirmation
    const CONFIDENCE_FAIL  = 30;   // Below this → treat as unreadable

    // ─── DOM References ─────────────────────────────────────
    const fileInput        = document.getElementById('file-input');
    const previewWrapper   = document.getElementById('preview-wrapper');
    const previewImg       = document.getElementById('preview-img');
    const progressSection  = document.getElementById('progress-section');
    const progressBar      = document.getElementById('progress-bar');
    const progressLabel    = document.getElementById('progress-label');
    const resultSection    = document.getElementById('result-section');
    const detectedSerial   = document.getElementById('detected-serial');
    const alertLowConf     = document.getElementById('alert-low-confidence');
    const alertUnreadable  = document.getElementById('alert-unreadable');
    const alertSuccess     = document.getElementById('alert-success');
    const alertSuccessText = document.getElementById('alert-success-text');
    const overrideSection  = document.getElementById('override-section');
    const overrideInput    = document.getElementById('override-input');
    const btnSave          = document.getElementById('btn-save');
    const btnReset         = document.getElementById('btn-reset');
    const actionButtons    = document.getElementById('action-buttons');
    const recentList       = document.getElementById('recent-list');

    // Duplicate modal
    const duplicateModal   = document.getElementById('duplicate-modal');
    const modalSerial      = document.getElementById('modal-serial');
    const modalBtnDupe     = document.getElementById('modal-btn-duplicate');
    const modalBtnCancel   = document.getElementById('modal-btn-cancel');

    // ─── State ──────────────────────────────────────────────
    let sessionScans = [];
    let pendingSerial = '';
    let ocrConfidence = 0;
    let isProcessing  = false;

    // ─── Helpers ────────────────────────────────────────────

    function show(el)  { el.classList.add('visible'); }
    function hide(el)  { el.classList.remove('visible'); }

    function hideAllAlerts() {
        hide(alertLowConf);
        hide(alertUnreadable);
        hide(alertSuccess);
    }

    function resetUI() {
        hideAllAlerts();
        hide(previewWrapper);
        hide(progressSection);
        hide(resultSection);
        hide(overrideSection);
        hide(duplicateModal);
        detectedSerial.textContent = '';
        overrideInput.value = '';
        progressBar.style.width = '0%';
        progressLabel.textContent = 'Initializing OCR…';
        btnSave.disabled = true;
        pendingSerial = '';
        ocrConfidence = 0;
        isProcessing = false;
        fileInput.value = '';
    }

    function getSerialValue() {
        const override = overrideInput.value.trim();
        return override || pendingSerial;
    }

    function addToRecentList(serial) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        sessionScans.unshift({ serial, time: timeStr });

        // Re-render
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

    // ─── OCR Processing ─────────────────────────────────────

    async function processImage(imageSource) {
        if (isProcessing) return;
        isProcessing = true;

        hideAllAlerts();
        show(progressSection);
        hide(resultSection);
        hide(overrideSection);
        btnSave.disabled = true;

        try {
            const worker = await Tesseract.createWorker('eng', 1, {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        const pct = Math.round(m.progress * 100);
                        progressBar.style.width = pct + '%';
                        progressLabel.textContent = `Recognizing… ${pct}%`;
                    } else {
                        progressLabel.textContent = m.status || 'Processing…';
                    }
                },
            });

            const { data } = await worker.recognize(imageSource);
            await worker.terminate();

            hide(progressSection);
            show(resultSection);

            // Extract text — take the most "dense" line as the serial
            const rawText = data.text.trim();
            ocrConfidence = data.confidence;

            // Attempt to pick the best line (longest line with alphanumeric content)
            const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            let bestLine = '';
            let bestScore = 0;

            for (const line of lines) {
                // Score: favour lines with high alphanumeric ratio and reasonable length
                const alphaNum = line.replace(/[^a-zA-Z0-9]/g, '').length;
                const score = alphaNum;
                if (score > bestScore) {
                    bestScore = score;
                    bestLine = line;
                }
            }

            pendingSerial = bestLine || rawText;
            detectedSerial.textContent = pendingSerial || '(nothing detected)';

            // Evaluate confidence
            if (ocrConfidence < CONFIDENCE_FAIL || !pendingSerial) {
                // Unreadable
                show(alertUnreadable);
                show(overrideSection);
                overrideInput.focus();
                detectedSerial.textContent = pendingSerial || '(unable to read)';
                btnSave.disabled = false; // they can type manually
            } else if (ocrConfidence < CONFIDENCE_LOW) {
                // Low confidence
                show(alertLowConf);
                show(overrideSection);
                overrideInput.value = pendingSerial;
                overrideInput.focus();
                overrideInput.select();
                btnSave.disabled = false;
            } else {
                // Good read
                btnSave.disabled = false;
            }

        } catch (err) {
            console.error('OCR Error:', err);
            hide(progressSection);
            show(resultSection);
            show(alertUnreadable);
            show(overrideSection);
            detectedSerial.textContent = '(OCR failed)';
            overrideInput.focus();
            btnSave.disabled = false;
        }

        isProcessing = false;
    }

    // ─── API Calls ──────────────────────────────────────────

    async function checkDuplicate(serial) {
        try {
            const resp = await fetch(`${API_URL}?action=check&serial=${encodeURIComponent(serial)}`);
            const json = await resp.json();
            return json.exists === true;
        } catch (err) {
            console.error('Duplicate check failed:', err);
            return false; // fail-open: allow save if API unreachable
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
            show(alertUnreadable);
            return;
        }

        btnSave.disabled = true;
        btnSave.innerHTML = '<span class="spinner"></span> Checking…';

        // 1. Check for duplicate
        const isDuplicate = await checkDuplicate(serial);

        if (isDuplicate) {
            // Show modal
            modalSerial.textContent = serial;
            show(duplicateModal);
            btnSave.innerHTML = 'Save to CSV';
            btnSave.disabled = false;
            return;
        }

        // 2. Save directly
        await performSave(serial);
    }

    async function performSave(serial) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<span class="spinner"></span> Saving…';

        const success = await saveSerial(serial);

        if (success) {
            hideAllAlerts();
            hide(overrideSection);
            alertSuccessText.textContent = `"${serial}" saved to CSV!`;
            show(alertSuccess);
            addToRecentList(serial);
            actionButtons.innerHTML = `
                <button class="btn btn-primary" id="btn-scan-again" style="width:100%;">
                    📷 Scan Another
                </button>
            `;
            document.getElementById('btn-scan-again').addEventListener('click', resetUI);
        } else {
            btnSave.innerHTML = 'Save to CSV';
            btnSave.disabled = false;
            const errAlert = alertUnreadable;
            errAlert.querySelector('span:last-child').textContent = 'Failed to save. Please try again.';
            show(errAlert);
        }
    }

    // ─── Event Listeners ────────────────────────────────────

    // File input change → capture photo
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            previewImg.src = ev.target.result;
            show(previewWrapper);
            processImage(ev.target.result);
        };
        reader.readAsDataURL(file);
    });

    // Save button
    btnSave.addEventListener('click', handleSave);

    // Reset button
    btnReset.addEventListener('click', resetUI);

    // Override input → enable save when non-empty
    overrideInput.addEventListener('input', () => {
        btnSave.disabled = overrideInput.value.trim() === '' && !pendingSerial;
    });

    // Modal: Add duplicate anyway
    modalBtnDupe.addEventListener('click', async () => {
        hide(duplicateModal);
        const serial = getSerialValue();
        await performSave(serial);
    });

    // Modal: Cancel
    modalBtnCancel.addEventListener('click', () => {
        hide(duplicateModal);
        btnSave.innerHTML = 'Save to CSV';
        btnSave.disabled = false;
    });

    // Close modal on overlay click
    duplicateModal.addEventListener('click', (e) => {
        if (e.target === duplicateModal) {
            hide(duplicateModal);
            btnSave.innerHTML = 'Save to CSV';
            btnSave.disabled = false;
        }
    });

})();
