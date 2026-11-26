import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  setMobileThreadReminder,
  closeMobileThreadReminder,
  setMobileThreadArchived,
  filterMobileThreadsByTab
} from '../../src/client/utils/mobileFollowup.js';

describe('mobileFollowup.js utilities', () => {
  const baseNow = Date.parse('2026-11-26T10:00:00.000Z');
  const futureIso = '2026-11-26T12:00:00.000Z';
  const pastIso = '2026-11-26T09:00:00.000Z';

  test('setMobileThreadReminder validates due_at, note length, and thread existence', () => {
    const threads = [{ id: 't1', contact_name: 'Khách A' }];

    const past = setMobileThreadReminder(threads, 't1', { due_at: pastIso, note: 'Gọi lại' }, baseNow);
    assert.equal(past.ok, false);
    assert.equal(past.status, 400);

    const tooLong = setMobileThreadReminder(threads, 't1', { due_at: futureIso, note: 'a'.repeat(201) }, baseNow);
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.status, 400);

    const missing = setMobileThreadReminder(threads, 't999', { due_at: futureIso, note: 'Gọi lại' }, baseNow);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);

    const ok = setMobileThreadReminder(threads, 't1', { due_at: futureIso, note: '  Gọi lại tư vấn  ' }, baseNow);
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, 'active');
    assert.equal(ok.data.note, 'Gọi lại tư vấn');
    assert.equal(ok.threads[0].reminder_due_at, futureIso);
    assert.equal(ok.threads[0].reminder_status, 'active');
  });

  test('closeMobileThreadReminder completes/cancels active reminder and returns 404 when none active', () => {
    const withReminder = [{ id: 't1', reminder_due_at: futureIso, reminder_note: 'Gọi lại', reminder_status: 'active' }];
    const closed = closeMobileThreadReminder(withReminder, 't1');
    assert.equal(closed.ok, true);
    assert.equal(closed.threads[0].reminder_due_at, null);
    assert.equal(closed.threads[0].reminder_note, null);
    assert.equal(closed.threads[0].reminder_status, null);

    const again = closeMobileThreadReminder(closed.threads, 't1');
    assert.equal(again.ok, false);
    assert.equal(again.status, 404);
  });

  test('setMobileThreadArchived archives and restores thread properly', () => {
    const threads = [{ id: 't1', archived_at: null }];
    const archived = setMobileThreadArchived(threads, 't1', true, '2026-11-26T10:05:00.000Z');
    assert.equal(archived.ok, true);
    assert.equal(archived.data.archived_at, '2026-11-26T10:05:00.000Z');
    assert.equal(archived.threads[0].archived_at, '2026-11-26T10:05:00.000Z');

    const restored = setMobileThreadArchived(archived.threads, 't1', false);
    assert.equal(restored.ok, true);
    assert.equal(restored.data.archived_at, null);
    assert.equal(restored.threads[0].archived_at, null);

    const missing = setMobileThreadArchived(threads, 't999', true);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);
  });

  test('filterMobileThreadsByTab preserves archived threads on ALL and filters WAITING/ARCHIVED accurately', () => {
    const threads = [
      { id: 't1', inbox_folder: 'INBOX', archived_at: null, last_msg_ts: 100 },
      { id: 't2', inbox_folder: 'INBOX', archived_at: '2026-11-25T00:00:00.000Z', last_msg_ts: 200 },
      { id: 't3', inbox_folder: 'MESSAGE_REQUEST_POSSIBLE', archived_at: null, last_msg_ts: 300 },
      { id: 't4', inbox_folder: 'MESSAGE_REQUEST_SPAM', archived_at: '2026-11-25T00:00:00.000Z', last_msg_ts: 400 }
    ];

    const allTab = filterMobileThreadsByTab(threads, 'ALL');
    assert.deepEqual(allTab.map((t) => t.id), ['t2', 't1']);

    const archivedTab = filterMobileThreadsByTab(threads, 'archived');
    assert.deepEqual(archivedTab.map((t) => t.id), ['t4', 't2']);

    const waitingTab = filterMobileThreadsByTab(threads, 'WAITING');
    assert.deepEqual(waitingTab.map((t) => t.id), ['t3']);
  });
});
