/**
 * Serial Scanner – Live CSV Viewer
 * 
 * Polls the API every 3 seconds for the latest CSV data
 * and renders it in a responsive table. Supports CSV download.
 */

(function () {
    'use strict';

    // ─── Configuration ──────────────────────────────────────
    const API_URL       = 'api.php';
    const POLL_INTERVAL = 3000; // milliseconds

    // ─── DOM References ─────────────────────────────────────
    const entryCount  = document.getElementById('entry-count');
    const emptyState  = document.getElementById('empty-state');
    const csvTable    = document.getElementById('csv-table');
    const csvTbody    = document.getElementById('csv-tbody');
    const btnDownload = document.getElementById('btn-download');

    // ─── State ──────────────────────────────────────────────
    let lastRowCount = -1;

    // ─── Helpers ────────────────────────────────────────────

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Fetch & Render ─────────────────────────────────────

    async function fetchAndRender() {
        try {
            const resp = await fetch(`${API_URL}?action=list&_t=${Date.now()}`);
            if (!resp.ok) return;
            const json = await resp.json();

            const rows = json.rows || [];
            const count = json.count || 0;

            // Skip re-render if nothing changed
            if (count === lastRowCount) return;
            lastRowCount = count;

            entryCount.textContent = `${count} ${count === 1 ? 'Entry' : 'Entries'}`;

            if (count === 0) {
                emptyState.style.display = 'block';
                csvTable.style.display = 'none';
                btnDownload.style.display = 'none';
                return;
            }

            emptyState.style.display = 'none';
            csvTable.style.display = 'table';
            btnDownload.style.display = 'block';

            // Build table body — newest first
            csvTbody.innerHTML = '';
            const reversed = [...rows].reverse();
            reversed.forEach((row, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="col-row">${count - i}</td>
                    <td class="col-serial">${escapeHtml(row.serial)}</td>
                    <td>${escapeHtml(row.timestamp)}</td>
                `;
                csvTbody.appendChild(tr);
            });

        } catch (err) {
            console.error('Failed to fetch CSV data:', err);
        }
    }

    // ─── CSV Download ───────────────────────────────────────

    function downloadCSV() {
        // Build CSV content from the current table data
        const link = document.createElement('a');
        link.href = `${API_URL}?action=list&_t=${Date.now()}`;

        // Fetch JSON and convert to CSV blob
        fetch(`${API_URL}?action=list`)
            .then(r => r.json())
            .then(json => {
                const rows = json.rows || [];
                let csv = 'SerialNumber,Timestamp\n';
                rows.forEach(row => {
                    // Escape quotes in serial numbers
                    const serial = row.serial.replace(/"/g, '""');
                    csv += `"${serial}","${row.timestamp}"\n`;
                });

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `serials_${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            })
            .catch(err => {
                console.error('Download failed:', err);
                alert('Failed to download CSV. Please try again.');
            });
    }

    // ─── Event Listeners ────────────────────────────────────

    btnDownload.addEventListener('click', downloadCSV);

    // ─── Start Polling ──────────────────────────────────────

    fetchAndRender(); // initial load
    setInterval(fetchAndRender, POLL_INTERVAL);

})();
