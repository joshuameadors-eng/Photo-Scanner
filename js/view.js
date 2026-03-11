/**
 * Serial Scanner – Local CSV Viewer
 */

(function () {
    'use strict';

    const STORAGE_KEY   = 'scannedSerials';
    const POLL_INTERVAL = 3000;

    const entryCount   = document.getElementById('entry-count');
    const emptyState   = document.getElementById('empty-state');
    const csvTable     = document.getElementById('csv-table');
    const csvTbody      = document.getElementById('csv-tbody');
    const btnDownload   = document.getElementById('btn-download');
    const btnClearData  = document.getElementById('btn-clear-data');
    const viewerActions = document.getElementById('viewer-actions');
    const themeToggle   = document.getElementById('theme-toggle');

    let lastRowCount = -1;

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
        const root = document.documentElement;
        if (root.classList.contains('dark-theme')) {
            localStorage.setItem('theme', 'light');
            applyTheme('light');
        } else {
            localStorage.setItem('theme', 'dark');
            applyTheme('dark');
        }
    }

    function fetchAndRender() {
        const rows = getStoredScans();
        const count = rows.length;

        if (count === lastRowCount) return;
        lastRowCount = count;

        entryCount.textContent = `${count} ${count === 1 ? 'Entry' : 'Entries'}`;

        if (count === 0) {
            emptyState.style.display = 'block';
            csvTable.style.display = 'none';
            if (viewerActions) viewerActions.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        csvTable.style.display = 'table';
        if (viewerActions) viewerActions.style.display = 'flex';

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
    }

    function downloadCSV() {
        const rows = getStoredScans();
        if (!rows.length) {
            alert('No local scans to download yet.');
            return;
        }

        let csv = 'SerialNumber,Timestamp\n';
        rows.forEach(row => {
            const serial = String(row.serial || '').replace(/"/g, '""');
            const timestamp = String(row.timestamp || '').replace(/"/g, '""');
            csv += `"${serial}","${timestamp}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `serials_local_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function clearData() {
        if (!confirm('Are you sure you want to delete all scanned serial numbers from this device? This cannot be undone.')) return;
        localStorage.removeItem(STORAGE_KEY);
        lastRowCount = -1;
        fetchAndRender();
    }

    btnDownload.addEventListener('click', downloadCSV);
    if (btnClearData) btnClearData.addEventListener('click', clearData);
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    applyTheme(localStorage.getItem('theme'));
    fetchAndRender();
    setInterval(fetchAndRender, POLL_INTERVAL);
})();
