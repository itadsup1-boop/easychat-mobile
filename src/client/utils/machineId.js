/**
 * Unique Machine Hardware Identifier Utility.
 * On Capacitor Android, prefers the hardware-scoped ANDROID_ID via
 * @capacitor/device (stable across updates AND uninstall/reinstall when signed
 * with the same release keystore). Falls back to localStorage on web/desktop.
 */

let _stableIdPromise = null;

/**
 * Normalizes a native Android device identifier into a stable CRM machineId.
 * @param {string} rawId
 * @returns {string | null}
 */
export function formatAndroidMachineId(rawId) {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toUpperCase();
  if (!cleaned) return null;
  return `AND-${cleaned.slice(0, 32)}`;
}

export function getMachineId() {
  try {
    let id = window.localStorage?.getItem('crm_machine_id');
    if (!id) {
      const platform = navigator.platform || 'Win32';
      const screenRes = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
      const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
      id = `MAC-${platform.substring(0, 3).toUpperCase()}-${screenRes}-${rand}`;
      window.localStorage?.setItem('crm_machine_id', id);
    }
    return id;
  } catch (_) {
    return 'MAC-FALLBACK-00000000';
  }
}

/**
 * Resolves a stable machineId asynchronously:
 * - On Capacitor Android with @capacitor/device, reads Device.getId() (ANDROID_ID)
 *   and persists it into localStorage('crm_machine_id') so both sync and async callers match.
 * - On web/desktop, falls back to getMachineId().
 * @param {{ getNativeDeviceId?: () => Promise<{ identifier?: string } | null>, storage?: Storage, fallback?: () => string }} [options]
 * @returns {Promise<string>}
 */
export async function ensureStableMachineId(options = null) {
  // Custom options path (used by unit tests) bypasses module cache
  if (options && typeof options === 'object') {
    const storage = options.storage;
    const fallback = typeof options.fallback === 'function' ? options.fallback : getMachineId;
    try {
      if (typeof options.getNativeDeviceId === 'function') {
        const res = await options.getNativeDeviceId();
        const formatted = formatAndroidMachineId(res?.identifier);
        if (formatted) {
          try { storage?.setItem('crm_machine_id', formatted); } catch (_) {}
          return formatted;
        }
      }
    } catch (_) {}
    return fallback();
  }

  if (_stableIdPromise) return _stableIdPromise;

  _stableIdPromise = (async () => {
    try {
      const devicePlugin = typeof window !== 'undefined' ? window.Capacitor?.Plugins?.Device : null;
      if (devicePlugin && typeof devicePlugin.getId === 'function') {
        const info = await devicePlugin.getId();
        const formatted = formatAndroidMachineId(info?.identifier);
        if (formatted) {
          try { window.localStorage?.setItem('crm_machine_id', formatted); } catch (_) {}
          return formatted;
        }
      }
    } catch (_) {}
    return getMachineId();
  })();

  return _stableIdPromise;
}

export function getStoredLicenseKey() {
  try {
    return window.localStorage?.getItem('crm_license_key') || '';
  } catch (_) {
    return '';
  }
}

export function setStoredLicenseKey(key) {
  try {
    if (key) {
      window.localStorage?.setItem('crm_license_key', key.trim());
    } else {
      window.localStorage?.removeItem('crm_license_key');
    }
  } catch (_) {}
}
