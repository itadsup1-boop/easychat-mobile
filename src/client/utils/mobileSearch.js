/**
 * Pure search utilities for Mobile Standalone Engine & SearchOverlay.
 * Produces the exact array contract expected by SearchOverlay.jsx
 * (matching Desktop's SearchService.searchMessages output).
 */

/**
 * Normalizes any /api/search payload into a safe array so SearchOverlay
 * never crashes on non-array responses (e.g. HTTP errors or legacy shapes).
 * @param {unknown} payload
 * @returns {Array<object>}
 */
export function normalizeSearchResults(payload) {
  if (Array.isArray(payload)) return payload;
  return [];
}

/**
 * Builds a plain-text snippet with <mark>...</mark> around case-insensitive
 * matches, matching SQLite FTS5 snippet(..., '<mark>', '</mark>', '...', 20).
 * Strips any pre-existing <mark> tags from source text first.
 * @param {string} rawText
 * @param {string} rawQuery
 * @param {number} [maxRadius=40]
 * @returns {string}
 */
export function buildSearchHighlight(rawText, rawQuery, maxRadius = 40) {
  const text = String(rawText || '').replace(/<\/?mark>/gi, '');
  const query = String(rawQuery || '').trim();
  if (!text) return '';
  if (!query) return text.length > maxRadius * 2 ? `${text.slice(0, maxRadius * 2)}...` : text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const firstIdx = lowerText.indexOf(lowerQuery);
  if (firstIdx === -1) {
    return text.length > maxRadius * 2 ? `${text.slice(0, maxRadius * 2)}...` : text;
  }

  const start = Math.max(0, firstIdx - maxRadius);
  const end = Math.min(text.length, firstIdx + query.length + maxRadius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  const snippet = text.slice(start, end);

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(${escapedQuery})`, 'gi');
  return `${prefix}${snippet.replace(matcher, '<mark>$1</mark>')}${suffix}`;
}

/**
 * Splits a highlight string containing <mark>...</mark> tags into safe render tokens.
 * @param {string} highlightText
 * @returns {Array<{ text: string, marked: boolean }>}
 */
export function tokenizeHighlight(highlightText) {
  const input = String(highlightText || '');
  if (!input) return [];

  const tokens = [];
  const regex = /<mark>([\s\S]*?)<\/mark>/gi;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: input.slice(lastIndex, match.index), marked: false });
    }
    if (match[1]) {
      tokens.push({ text: match[1], marked: true });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < input.length) {
    tokens.push({ text: input.slice(lastIndex), marked: false });
  }
  return tokens;
}

function toSortTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(timestampMs, fallbackIso) {
  if (fallbackIso) return fallbackIso;
  if (typeof timestampMs === 'number' && Number.isFinite(timestampMs) && timestampMs > 0) {
    return new Date(timestampMs).toISOString();
  }
  return null;
}

/**
 * Searches messages and threads in the mobile standalone store.
 * Returns an Array of objects matching Desktop's GET /api/search contract.
 * @param {object} store
 * @param {string} rawQuery
 * @param {number} [rawLimit=20]
 * @returns {Array<object>}
 */
export function searchMobileStore(store, rawQuery, rawLimit = 20) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  const qLower = query.toLowerCase();
  const parsedLimit = Number(rawLimit);
  const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20, 100));

  const threads = Array.isArray(store?.threads) ? store.threads : [];
  const messagesByThread = store?.messagesByThread && typeof store.messagesByThread === 'object'
    ? store.messagesByThread
    : {};
  const contactsByThread = store?.contactsByThread && typeof store.contactsByThread === 'object'
    ? store.contactsByThread
    : {};

  const threadMap = new Map();
  for (const t of threads) {
    if (t && t.id != null) {
      threadMap.set(String(t.id), t);
    }
  }

  const results = [];
  const threadsWithMessageMatch = new Set();

  // 1. Search individual messages across all threads
  for (const [tid, msgs] of Object.entries(messagesByThread)) {
    if (!Array.isArray(msgs) || msgs.length === 0) continue;
    const thread = threadMap.get(String(tid));
    const contact = contactsByThread[String(tid)];
    const displayName = contact?.nickname || thread?.nickname || thread?.contact_name || 'Khách hàng';
    const accountId = thread?.account_id || thread?.source_id || null;

    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const content = String(m?.content || '');
      if (!content || !content.toLowerCase().includes(qLower)) continue;

      threadsWithMessageMatch.add(String(tid));
      const ts = toSortTimestamp(m?.timestamp_ms)
        || toSortTimestamp(m?.created_at)
        || toSortTimestamp(thread?.last_activity);
      const createdAt = toIsoDate(Number(m?.timestamp_ms), m?.created_at || thread?.last_activity || null);
      const msgId = m?.id || m?.fb_message_id || m?.client_message_id || `msg:${tid}:${i}`;

      results.push({
        id: String(msgId),
        thread_id: String(tid),
        sender_id: m?.sender_id || null,
        content,
        is_outgoing: Boolean(m?.is_outgoing),
        created_at: createdAt,
        contact_name: displayName,
        account_id: accountId,
        highlight: buildSearchHighlight(content, query),
        _sortTs: ts
      });
    }
  }

  // 2. Search thread metadata (contact_name, nickname, phone, last_message)
  for (const t of threads) {
    if (!t || t.id == null) continue;
    const tid = String(t.id);
    const contact = contactsByThread[tid];
    const displayName = contact?.nickname || t.nickname || t.contact_name || 'Khách hàng';
    const phone = String(contact?.phone || t.phone || '').trim();
    const lastMessage = String(t.last_message || '').trim();

    const metaMatches = [t.contact_name, t.nickname, contact?.nickname, phone]
      .filter(Boolean)
      .some((val) => String(val).toLowerCase().includes(qLower));
    const lastMsgMatches = lastMessage.toLowerCase().includes(qLower);

    if (!metaMatches && (!lastMsgMatches || threadsWithMessageMatch.has(tid))) {
      continue;
    }

    const preview = lastMsgMatches
      ? lastMessage
      : [displayName, phone ? `(${phone})` : '', lastMessage ? `— ${lastMessage}` : '']
          .filter(Boolean)
          .join(' ');

    const ts = toSortTimestamp(t.last_activity);
    results.push({
      id: `thread:${tid}`,
      thread_id: tid,
      sender_id: null,
      content: preview,
      is_outgoing: false,
      created_at: t.last_activity || null,
      contact_name: displayName,
      account_id: t.account_id || t.source_id || null,
      highlight: buildSearchHighlight(preview, query),
      _sortTs: ts
    });
  }

  results.sort((a, b) => b._sortTs - a._sortTs);

  return results.slice(0, limit).map(({ _sortTs, ...item }) => item);
}
