/**
 * Lightweight IndexedDB persistence for mobile staged media blobs (Chat & Campaigns).
 * Prevents storing large binaries or dead blob: URLs in localStorage while allowing
 * campaign attachments to survive app reloads.
 */

const DB_NAME = 'easychat_mobile_media_v1';
const STORE_NAME = 'attachments';
const DB_VERSION = 1;

let dbPromise = null;

function openMediaDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return dbPromise;
}

/**
 * Persists a staged File/Blob record into IndexedDB.
 * @param {string} id
 * @param {{ file: Blob, name?: string, safe_name?: string, original_name?: string, mime_type?: string, media_type?: string, byte_size?: number }} record
 */
export async function saveMediaBlobToIdb(id, record) {
  const key = String(id || '');
  if (!key || !record?.file) return false;
  const db = await openMediaDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({
        id: key,
        file: record.file,
        name: record.safe_name || record.name || record.original_name || 'attachment',
        original_name: record.original_name || record.name || 'attachment',
        safe_name: record.safe_name || record.name || 'attachment',
        mime_type: record.mime_type || record.file.type || 'application/octet-stream',
        media_type: record.media_type || 'file',
        byte_size: Number(record.byte_size ?? record.size ?? record.file.size ?? 0),
        saved_at: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Loads a previously persisted File/Blob record from IndexedDB.
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function loadMediaBlobFromIdb(id) {
  const key = String(id || '');
  if (!key) return null;
  const db = await openMediaDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Deletes a persisted File/Blob record from IndexedDB.
 * @param {string} id
 */
export async function deleteMediaBlobFromIdb(id) {
  const key = String(id || '');
  if (!key) return false;
  const db = await openMediaDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}
