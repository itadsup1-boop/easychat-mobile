/**
 * Pure utilities for Thread Follow-up (Reminders, Archive, Restore)
 * and Tab Filtering in Mobile Standalone Engine.
 * Mirrors Desktop FollowupService.js and AssignmentManager.js behavior.
 */

const WAITING_FOLDERS = new Set(['MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE']);

/**
 * Sets or updates an active reminder on a thread.
 * @param {Array<object>} threads
 * @param {string} threadId
 * @param {{ due_at?: string, note?: string }} payload
 * @param {number} [now=Date.now()]
 */
export function setMobileThreadReminder(threads, threadId, payload = {}, now = Date.now()) {
  const tid = String(threadId ?? '');
  const dueAt = new Date(payload?.due_at);
  const note = String(payload?.note || '').trim();

  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= now) {
    return { ok: false, status: 400, data: { error: 'Thời điểm nhắc phải ở tương lai.' }, threads };
  }
  if (note.length > 200) {
    return { ok: false, status: 400, data: { error: 'Ghi chú nhắc tối đa 200 ký tự.' }, threads };
  }

  const list = Array.isArray(threads) ? threads : [];
  const exists = list.some((t) => String(t?.id) === tid);
  if (!exists) {
    return { ok: false, status: 404, data: { error: 'Không tìm thấy hội thoại.' }, threads: list };
  }

  const dueIso = dueAt.toISOString();
  const nextNote = note || null;
  const nextThreads = list.map((t) => (
    String(t?.id) === tid
      ? { ...t, reminder_due_at: dueIso, reminder_note: nextNote, reminder_status: 'active' }
      : t
  ));

  return {
    ok: true,
    status: 200,
    data: { thread_id: tid, due_at: dueIso, note: nextNote, status: 'active' },
    threads: nextThreads
  };
}

/**
 * Completes or cancels an active reminder on a thread.
 * @param {Array<object>} threads
 * @param {string} threadId
 */
export function closeMobileThreadReminder(threads, threadId) {
  const tid = String(threadId ?? '');
  const list = Array.isArray(threads) ? threads : [];
  const target = list.find((t) => String(t?.id) === tid);

  const hasActive = Boolean(
    target
    && target.reminder_due_at
    && (!target.reminder_status || target.reminder_status === 'active')
  );
  if (!hasActive) {
    return { ok: false, status: 404, data: { error: 'Không có nhắc đang hoạt động.' }, threads: list };
  }

  const nextThreads = list.map((t) => (
    String(t?.id) === tid
      ? { ...t, reminder_due_at: null, reminder_note: null, reminder_status: null }
      : t
  ));

  return {
    ok: true,
    status: 200,
    data: { success: true },
    threads: nextThreads
  };
}

/**
 * Archives or restores a thread.
 * @param {Array<object>} threads
 * @param {string} threadId
 * @param {boolean} archived
 * @param {string} [nowIso]
 */
export function setMobileThreadArchived(threads, threadId, archived, nowIso = new Date().toISOString()) {
  const tid = String(threadId ?? '');
  const list = Array.isArray(threads) ? threads : [];
  const exists = list.some((t) => String(t?.id) === tid);
  if (!exists) {
    return { ok: false, status: 404, data: { error: 'Không tìm thấy hội thoại.' }, threads: list };
  }

  const archivedAt = archived ? nowIso : null;
  const nextThreads = list.map((t) => (
    String(t?.id) === tid ? { ...t, archived_at: archivedAt } : t
  ));

  return {
    ok: true,
    status: 200,
    data: { success: true, archived_at: archivedAt },
    threads: nextThreads
  };
}

/**
 * Filters and sorts threads by requested tab, matching Desktop AssignmentManager.
 * Notably, normal tabs (ALL/UNPROCESSED/ASSIGNED/COMPLETED) retain archived threads
 * so ConversationSidebar's client-side archive scope filter ('inbox' | 'archived' | 'all')
 * can display archived conversations and resurface due reminders.
 * @param {Array<object>} threads
 * @param {string} [rawTab='ALL']
 * @returns {Array<object>}
 */
export function filterMobileThreadsByTab(threads, rawTab = 'ALL') {
  const list = Array.isArray(threads) ? threads : [];
  const tab = String(rawTab || 'ALL').trim().toUpperCase();

  const filtered = list.filter((t) => {
    if (!t) return false;
    const folder = String(t.inbox_folder || 'INBOX').toUpperCase();
    const isWaitingFolder = WAITING_FOLDERS.has(folder);

    if (tab === 'WAITING') {
      return isWaitingFolder && !t.archived_at;
    }
    if (tab === 'ARCHIVED') {
      return Boolean(t.archived_at);
    }

    if (isWaitingFolder) return false;

    if (tab === 'UNPROCESSED' || tab === 'ASSIGNED' || tab === 'COMPLETED') {
      return String(t.status || 'UNPROCESSED').toUpperCase() === tab;
    }
    return true;
  });

  return filtered
    .slice()
    .sort((a, b) => (
      (Number(b.pinned ?? b.is_pinned) || 0) - (Number(a.pinned ?? a.is_pinned) || 0)
      || ((Number(b.last_msg_ts) || 0) - (Number(a.last_msg_ts) || 0))
    ));
}
