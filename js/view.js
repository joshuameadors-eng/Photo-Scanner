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

    function setStoredScans(rows) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    }

    function overwriteMostRecentMatching(oldSerial, newSerial) {
        const rows = getStoredScans();
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].serial === oldSerial) {
                rows[i].serial = newSerial;
                rows[i].timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
                setStoredScans(rows);
                return true;
            }
        }
        return false;
    }

    function removeMostRecentMatching(serial) {
        const rows = getStoredScans();
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].serial === serial) {
                rows.splice(i, 1);
                setStoredScans(rows);
                return true;
            }
        }
        return false;
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
                <td class="col-actions">
                    <span class="row-actions">
                        <button class="btn-icon" data-action="edit" data-serial="${escapeHtml(row.serial)}" title="Overwrite">✏️</button>
                        <button class="btn-icon btn-icon-danger" data-action="delete" data-serial="${escapeHtml(row.serial)}" title="Remove">🗑️</button>
                    </span>
                </td>
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

    if (csvTbody) csvTbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        const serial = btn.getAttribute('data-serial') || '';
        const action = btn.getAttribute('data-action');

        if (action === 'edit') {
            const updated = prompt('Overwrite serial number:', serial);
            if (!updated || !updated.trim()) return;
            const newSerial = updated.trim();
            const ok = overwriteMostRecentMatching(serial, newSerial);
            if (ok) {
                lastRowCount = -1;
                fetchAndRender();
            }
            return;
        }

        if (action === 'delete') {
            const confirmed = confirm(`Remove serial "${serial}"?`);
            if (!confirmed) return;
            const ok = removeMostRecentMatching(serial);
            if (ok) {
                lastRowCount = -1;
                fetchAndRender();
            }
        }
    });

    applyTheme(localStorage.getItem('theme'));
    fetchAndRender();
    setInterval(fetchAndRender, POLL_INTERVAL);
})();
