import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAndroidMachineId,
  ensureStableMachineId
} from '../../src/client/utils/machineId.js';

describe('machineId.js stable Android identifier', () => {
  test('formatAndroidMachineId normalizes Android ID and strips invalid characters', () => {
    assert.equal(formatAndroidMachineId('a1b2c3d4e5f60708'), 'AND-A1B2C3D4E5F60708');
    assert.equal(formatAndroidMachineId('  ab:cd:ef  '), 'AND-ABCDEF');
    assert.equal(formatAndroidMachineId(''), null);
    assert.equal(formatAndroidMachineId(null), null);
  });

  test('ensureStableMachineId returns identical AND-ID even after localStorage is wiped', async () => {
    const storeMap = new Map();
    const fakeStorage = {
      getItem: (k) => storeMap.get(k) ?? null,
      setItem: (k, v) => storeMap.set(k, String(v))
    };

    const first = await ensureStableMachineId({
      getNativeDeviceId: async () => ({ identifier: '9f8e7d6c5b4a3210' }),
      storage: fakeStorage,
      fallback: () => 'MAC-WEB-RANDOM1'
    });
    assert.equal(first, 'AND-9F8E7D6C5B4A3210');
    assert.equal(storeMap.get('crm_machine_id'), 'AND-9F8E7D6C5B4A3210');

    // Simulate uninstall/reinstall wiping localStorage
    storeMap.clear();
    const second = await ensureStableMachineId({
      getNativeDeviceId: async () => ({ identifier: '9f8e7d6c5b4a3210' }),
      storage: fakeStorage,
      fallback: () => 'MAC-WEB-RANDOM2'
    });
    assert.equal(second, first);
  });

  test('ensureStableMachineId falls back cleanly when native Device plugin is unavailable', async () => {
    const webId = await ensureStableMachineId({
      getNativeDeviceId: async () => null,
      fallback: () => 'MAC-WIN-1920X1080-ABCD1234'
    });
    assert.equal(webId, 'MAC-WIN-1920X1080-ABCD1234');
  });
});
