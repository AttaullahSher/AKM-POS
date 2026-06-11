// ===== Offline / sync status indicator =====
// Shows a header pill: green = synced, amber (pulsing) = syncing N, red = offline.
// Firestore's persistentLocalCache already saves writes offline and syncs them
// automatically when the connection returns — this just makes that visible.

import { db, waitForPendingWrites, enableNetwork } from './firebase-config.js';

let pending = 0;
let online  = navigator.onLine;

function render() {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  let state, label;
  if (!online && pending > 0) { state = 'offline'; label = `Offline · ${pending} unsynced`; }
  else if (!online)           { state = 'offline'; label = 'Offline'; }
  else if (pending > 0)       { state = 'syncing'; label = `Syncing ${pending}…`; }
  else                        { state = 'synced';  label = 'Synced'; }
  el.className = `sync-status ${state}`;
  el.innerHTML = `<span class="sync-dot"></span><span class="sync-label">${label}</span>`;
  el.title = online
    ? (pending ? `${pending} change(s) syncing to the cloud…` : 'All changes saved to the cloud')
    : `Offline — ${pending} change(s) saved on this device, will sync when internet returns. Click to retry.`;
}

/**
 * Call right after a successful write (invoice/deposit/expense/refund).
 * Tracks it until Firestore confirms it reached the server.
 */
export function notePendingWrite() {
  pending++;
  render();
  waitForPendingWrites(db)
    .then(() => { pending = 0; render(); })
    .catch(() => { /* offline — stays pending, will resolve when back online */ });
}

export function initSyncStatus() {
  window.addEventListener('online', () => {
    online = true; render();
    enableNetwork(db).catch(() => {});
    if (pending > 0) waitForPendingWrites(db).then(() => { pending = 0; render(); }).catch(() => {});
  });
  window.addEventListener('offline', () => { online = false; render(); });

  const el = document.getElementById('syncStatus');
  if (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', async () => {
      try {
        await enableNetwork(db);
        await waitForPendingWrites(db);
        pending = 0;
      } catch { /* still offline */ }
      online = navigator.onLine;
      render();
    });
  }
  render();
}
