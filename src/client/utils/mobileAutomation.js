/**
 * Pure CRUD utilities for Mobile Standalone Engine:
 * - Auto-Reply rules & keywords (AutoReplyModal.jsx)
 * - Dual-AI per-account config (AiConfigModal.jsx)
 * - Global Phone Automation settings (PhoneAutomationSettingsModal.jsx)
 * - Lead Status cleanup & Quick Template deletion
 */

let idSeq = 1;
function nextNumericId() {
  idSeq = (idSeq + 1) % 1000;
  return Date.now() * 1000 + idSeq;
}

function normalizeKeywordObjects(rawRule) {
  if (Array.isArray(rawRule?.keywords) && rawRule.keywords.length > 0) {
    return rawRule.keywords
      .map((k) => {
        if (typeof k === 'string') {
          const text = k.trim();
          return text ? { id: nextNumericId(), keyword: text, is_active: 1 } : null;
        }
        const text = String(k?.keyword || '').trim();
        if (!text) return null;
        return {
          id: k.id != null ? k.id : nextNumericId(),
          keyword: text,
          is_active: k.is_active === 0 || k.is_active === false ? 0 : 1
        };
      })
      .filter(Boolean);
  }
  const fallback = String(rawRule?.trigger_keyword || rawRule?.keyword || '').trim();
  if (!fallback) return [];
  return fallback
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ id: nextNumericId(), keyword: text, is_active: 1 }));
}

function normalizeAutoReplyRule(rawRule, fallbackAccountId = '') {
  const keywords = normalizeKeywordObjects(rawRule);
  return {
    id: rawRule?.id != null ? rawRule.id : nextNumericId(),
    account_id: String(rawRule?.account_id ?? fallbackAccountId ?? ''),
    trigger_keyword: keywords[0]?.keyword || String(rawRule?.trigger_keyword || rawRule?.keyword || ''),
    response_template: String(rawRule?.response_template ?? rawRule?.reply ?? ''),
    is_active: rawRule?.is_active === 0 || rawRule?.is_active === false ? 0 : 1,
    keywords,
    created_at: rawRule?.created_at || new Date().toISOString()
  };
}

export function listMobileAutoReplyRules(store, accountId) {
  if (!Array.isArray(store.autoReplyRules)) store.autoReplyRules = [];
  const accId = String(accountId || '').trim();
  const normalized = store.autoReplyRules.map((r) => normalizeAutoReplyRule(r, r?.account_id || accId));
  store.autoReplyRules = normalized;
  if (!accId) return normalized;
  return normalized.filter((r) => !r.account_id || String(r.account_id) === accId);
}

export function createMobileAutoReplyRule(store, accountId, body = {}) {
  if (!Array.isArray(store.autoReplyRules)) store.autoReplyRules = [];
  const accId = String(accountId || body?.account_id || '').trim();
  const responseTemplate = String(body?.response_template ?? body?.reply ?? '').trim();

  const rawList = Array.isArray(body?.keywords)
    ? body.keywords
    : String(body?.trigger_keyword || body?.keyword || '').split(',');

  const uniqueKeywords = [];
  const seen = new Set();
  for (const item of rawList) {
    const text = String(typeof item === 'string' ? item : item?.keyword || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueKeywords.push({ id: nextNumericId(), keyword: text, is_active: 1 });
  }

  if (uniqueKeywords.length === 0) {
    return { ok: false, status: 400, data: { error: 'Vui lòng nhập ít nhất 1 từ khóa.' } };
  }
  if (!responseTemplate) {
    return { ok: false, status: 400, data: { error: 'Vui lòng nhập nội dung phản hồi.' } };
  }

  const rule = {
    id: nextNumericId(),
    account_id: accId,
    trigger_keyword: uniqueKeywords[0].keyword,
    response_template: responseTemplate,
    is_active: 1,
    keywords: uniqueKeywords,
    created_at: new Date().toISOString()
  };

  store.autoReplyRules.push(rule);
  return { ok: true, status: 201, data: { success: true, rule, data: rule } };
}

export function toggleMobileAutoReplyRule(store, ruleId, isActive) {
  if (!Array.isArray(store.autoReplyRules)) store.autoReplyRules = [];
  const target = store.autoReplyRules.find((r) => String(r?.id) === String(ruleId));
  if (!target) return { ok: false, status: 404, data: { error: 'Không tìm thấy quy tắc.' } };

  target.is_active = isActive ? 1 : 0;
  return { ok: true, status: 200, data: { success: true, is_active: target.is_active } };
}

export function deleteMobileAutoReplyRule(store, ruleId) {
  if (!Array.isArray(store.autoReplyRules)) store.autoReplyRules = [];
  const before = store.autoReplyRules.length;
  store.autoReplyRules = store.autoReplyRules.filter((r) => String(r?.id) !== String(ruleId));
  if (store.autoReplyRules.length === before) {
    return { ok: false, status: 404, data: { error: 'Không tìm thấy quy tắc.' } };
  }
  return { ok: true, status: 200, data: { success: true } };
}

export function addMobileAutoReplyKeywords(store, ruleId, rawKeyword) {
  if (!Array.isArray(store.autoReplyRules)) store.autoReplyRules = [];
  const target = store.autoReplyRules.find((r) => String(r?.id) === String(ruleId));
  if (!target) return { ok: false, status: 404, data: { error: 'Không tìm thấy quy tắc.' } };

  if (!Array.isArray(target.keywords)) {
    target.keywords = normalizeKeywordObjects(target);
  }

  const parts = String(rawKeyword || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, status: 400, data: { error: 'Từ khóa không được để trống.' } };
  }

  const existingKeys = new Set(target.keywords.map((k) => String(k.keyword || '').toLowerCase()));
  const added = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const kwObj = { id: nextNumericId(), keyword: part, is_active: 1 };
    target.keywords.push(kwObj);
    added.push(kwObj);
  }

  if (added.length === 0) {
    return { ok: false, status: 409, data: { error: 'Từ khóa đã tồn tại trong quy tắc này.' } };
  }

  if (!target.trigger_keyword && target.keywords[0]) {
    target.trigger_keyword = target.keywords[0].keyword;
  }

  return { ok: true, status: 201, data: { success: true, keywords: added } };
}

export function toggleMobileAutoReplyKeyword(store, keywordId, isActive) {
  if (!Array.isArray(store.autoReplyRules)) store.autoReplyRules = [];
  for (const rule of store.autoReplyRules) {
    if (!Array.isArray(rule?.keywords)) continue;
    const kw = rule.keywords.find((k) => String(k?.id) === String(keywordId));
    if (kw) {
      kw.is_active = isActive ? 1 : 0;
      return { ok: true, status: 200, data: { success: true, is_active: kw.is_active } };
    }
  }
  return { ok: false, status: 404, data: { error: 'Không tìm thấy từ khóa.' } };
}

export function deleteMobileAutoReplyKeyword(store, keywordId) {
  if (!Array.isArray(store.autoReplyRules)) store.autoReplyRules = [];
  for (const rule of store.autoReplyRules) {
    if (!Array.isArray(rule?.keywords)) continue;
    const before = rule.keywords.length;
    rule.keywords = rule.keywords.filter((k) => String(k?.id) !== String(keywordId));
    if (rule.keywords.length !== before) {
      rule.trigger_keyword = rule.keywords[0]?.keyword || '';
      return { ok: true, status: 200, data: { success: true } };
    }
  }
  return { ok: false, status: 404, data: { error: 'Không tìm thấy từ khóa.' } };
}

// ── AI Config ──

const DEFAULT_AI_CONFIG = {
  provider: 'LOCAL_OLLAMA',
  model_name: 'llama3',
  system_prompt: 'Bạn là trợ lý tư vấn bán hàng chuyên nghiệp, thân thiện.',
  is_active: 0
};

export function getMobileAiConfig(store, accountId = '') {
  const accId = String(accountId || '').trim();
  const byAcc = store?.aiConfigByAccount && typeof store.aiConfigByAccount === 'object'
    ? store.aiConfigByAccount[accId]
    : null;
  const legacy = store?.aiConfig && typeof store.aiConfig === 'object' ? store.aiConfig : {};
  const src = byAcc || legacy;

  const provider = src.provider || DEFAULT_AI_CONFIG.provider;
  const modelName = src.model_name || src.model || DEFAULT_AI_CONFIG.model_name;
  const systemPrompt = src.system_prompt ?? DEFAULT_AI_CONFIG.system_prompt;
  const isActive = src.is_active !== undefined ? (src.is_active ? 1 : 0) : (src.enabled ? 1 : 0);

  return {
    success: true,
    account_id: accId || null,
    provider,
    model_name: modelName,
    model: modelName,
    system_prompt: systemPrompt,
    is_active: isActive,
    enabled: Boolean(isActive),
    has_api_key: Boolean(src.api_key)
  };
}

export function saveMobileAiConfig(store, accountId = '', body = {}) {
  const accId = String(accountId || '').trim();
  if (!store.aiConfigByAccount || typeof store.aiConfigByAccount !== 'object') {
    store.aiConfigByAccount = {};
  }

  const prev = (accId && store.aiConfigByAccount[accId]) || store.aiConfig || {};
  const nextModel = body.model_name ?? body.model ?? prev.model_name ?? prev.model ?? DEFAULT_AI_CONFIG.model_name;
  const nextActive = body.is_active !== undefined
    ? (body.is_active ? 1 : 0)
    : (body.enabled !== undefined ? (body.enabled ? 1 : 0) : (prev.is_active ? 1 : 0));

  const next = {
    provider: body.provider || prev.provider || DEFAULT_AI_CONFIG.provider,
    model_name: nextModel,
    model: nextModel,
    system_prompt: body.system_prompt !== undefined ? String(body.system_prompt) : (prev.system_prompt ?? DEFAULT_AI_CONFIG.system_prompt),
    is_active: nextActive,
    enabled: Boolean(nextActive),
    api_key: body.api_key ? String(body.api_key) : (prev.api_key || '')
  };

  if (accId) {
    store.aiConfigByAccount[accId] = next;
  }
  store.aiConfig = next;

  return getMobileAiConfig(store, accId);
}

// ── Phone Automation ──

export function getMobilePhoneAutomation(store) {
  const raw = store?.phoneAutomation && typeof store.phoneAutomation === 'object' ? store.phoneAutomation : {};
  const statusId = raw.status_id !== undefined
    ? (raw.status_id == null || raw.status_id === '' ? null : raw.status_id)
    : (raw.target_status_id ?? null);
  const enabled = Boolean(raw.enabled);

  return {
    success: true,
    enabled,
    status_id: statusId,
    target_status_id: statusId,
    policy: raw.policy || 'continue',
    thank_you_text: raw.thank_you_text || ''
  };
}

export function saveMobilePhoneAutomation(store, body = {}) {
  const enabled = Boolean(body?.enabled);
  const rawStatus = body?.status_id !== undefined ? body.status_id : body?.target_status_id;
  const statusId = rawStatus == null || rawStatus === '' ? null : rawStatus;

  if (enabled && statusId == null) {
    return { ok: false, status: 400, data: { error: 'Hãy chọn trạng thái đích trước khi bật tự động hóa.' } };
  }

  const prev = store?.phoneAutomation && typeof store.phoneAutomation === 'object' ? store.phoneAutomation : {};
  store.phoneAutomation = {
    ...prev,
    enabled,
    status_id: statusId,
    target_status_id: statusId,
    ...(body?.policy !== undefined ? { policy: body.policy } : {}),
    ...(body?.thank_you_text !== undefined ? { thank_you_text: body.thank_you_text } : {})
  };

  return { ok: true, status: 200, data: getMobilePhoneAutomation(store) };
}

// ── Lead Status & Quick Templates ──

export function deleteMobileLeadStatus(store, rawId) {
  const targetId = String(rawId ?? '');
  if (!Array.isArray(store.leadStatuses)) store.leadStatuses = [];
  store.leadStatuses = store.leadStatuses.filter((s) => String(s?.id) !== targetId);

  if (Array.isArray(store.threads)) {
    store.threads = store.threads.map((t) => {
      if (String(t?.status_id ?? '') !== targetId && String(t?.lead_status_id ?? '') !== targetId) return t;
      return { ...t, status_id: null, lead_status_id: null, status_name: null, status_color: null };
    });
  }

  if (store.contactsByThread && typeof store.contactsByThread === 'object') {
    for (const key of Object.keys(store.contactsByThread)) {
      const c = store.contactsByThread[key];
      if (!c) continue;
      if (String(c.status_id ?? '') === targetId || String(c.lead_status_id ?? '') === targetId) {
        store.contactsByThread[key] = { ...c, status_id: null, lead_status_id: null, status_name: null, status_color: null };
      }
    }
  }

  return { success: true };
}

export function deleteMobileQuickTemplate(store, rawId) {
  const targetId = String(rawId ?? '');
  if (!Array.isArray(store.quickTemplates)) store.quickTemplates = [];
  const before = store.quickTemplates.length;
  store.quickTemplates = store.quickTemplates.filter((tpl) => String(tpl?.id) !== targetId);
  if (store.quickTemplates.length === before) {
    return { ok: false, status: 404, data: { error: 'Không tìm thấy mẫu tin nhắn nhanh.' } };
  }
  return { ok: true, status: 200, data: { success: true } };
}

// ── Safe Vietnam Phone Extraction & Global Phone Automation Apply ──

/**
 * Extracts a valid Vietnam mobile phone number (03/05/07/08/09 + 8 digits, or +84/84 prefix)
 * while guarding against false positives inside long numbers/prices like "100.500.000.000".
 * @param {string} rawText
 * @returns {string | null}
 */
export function extractSafeVietnamPhone(rawText) {
  const text = String(rawText || '');
  if (!text) return null;
  const regex = /(?:^|[^\d])((?:\+?84|0)(?:[\s.\-()]?\d){9})(?!\d)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const compact = match[1].replace(/[\s.\-()]/g, '');
    if (/^(?:\+84|84|0)(3|5|7|8|9)\d{8}$/.test(compact)) {
      return '0' + compact.replace(/^(?:\+84|84|0)/, '');
    }
  }
  return null;
}

/**
 * Persists a captured customer phone on contactsByThread and applies the global
 * Phone Automation status rule if enabled (matching Desktop GlobalPhoneAutomationService).
 * @param {object} store
 * @param {string} threadId
 * @param {string} detectedPhone
 * @param {string} [customerName]
 */
export function applyMobilePhoneAutomation(store, threadId, detectedPhone, customerName = '') {
  const tid = String(threadId || '');
  if (!tid || !detectedPhone) {
    return { phoneCaptured: false, statusApplied: false, status: null, contact: null };
  }
  if (!store.contactsByThread || typeof store.contactsByThread !== 'object') {
    store.contactsByThread = {};
  }

  const existing = store.contactsByThread[tid] || {};
  const phoneCaptured = !existing.phone;
  const nextContact = {
    ...existing,
    thread_id: tid,
    name: existing.name || customerName || 'Khách hàng',
    phone: existing.phone || detectedPhone,
    lead_captured: 1,
    phone_captured_at: existing.phone_captured_at || new Date().toISOString()
  };

  let statusApplied = false;
  let appliedStatus = null;
  const settings = getMobilePhoneAutomation(store);
  if (settings.enabled && settings.status_id != null) {
    const statuses = Array.isArray(store.leadStatuses) ? store.leadStatuses : [];
    const targetStatus = statuses.find((s) => String(s?.id) === String(settings.status_id));
    if (targetStatus) {
      nextContact.status_id = targetStatus.id;
      nextContact.lead_status_id = targetStatus.id;
      nextContact.status_name = targetStatus.name;
      nextContact.status_color = targetStatus.color;
      statusApplied = true;
      appliedStatus = targetStatus;
    }
  }

  store.contactsByThread[tid] = nextContact;
  return { phoneCaptured, statusApplied, status: appliedStatus, contact: nextContact };
}

// ── Broadcast Quota & Template Helpers ──

export const DAILY_BROADCAST_LIMIT = 150;

function getTodayDateKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMobileBroadcastQuota(store, accountId = 'default', todayKey = getTodayDateKey()) {
  const key = String(accountId || 'default');
  const map = store?.broadcastQuotaByAccount && typeof store.broadcastQuotaByAccount === 'object'
    ? store.broadcastQuotaByAccount
    : {};
  const entry = map[key];
  const used = entry && entry.date === todayKey ? Math.max(0, Number(entry.used) || 0) : 0;
  return {
    used,
    limit: DAILY_BROADCAST_LIMIT,
    remaining: Math.max(0, DAILY_BROADCAST_LIMIT - used),
    date: todayKey
  };
}

export function consumeMobileBroadcastQuota(store, accountId = 'default', count = 1, todayKey = getTodayDateKey()) {
  const key = String(accountId || 'default');
  if (!store.broadcastQuotaByAccount || typeof store.broadcastQuotaByAccount !== 'object') {
    store.broadcastQuotaByAccount = {};
  }
  const current = getMobileBroadcastQuota(store, key, todayKey);
  const nextUsed = current.used + Math.max(0, Number(count) || 0);
  store.broadcastQuotaByAccount[key] = { date: todayKey, used: nextUsed };
  return getMobileBroadcastQuota(store, key, todayKey);
}

export function renderBroadcastTemplate(template, contactName = '') {
  const name = String(contactName || 'bạn').trim() || 'bạn';
  return String(template || '')
    .replace(/\{ten_khach_hang\}/gi, name)
    .replace(/\{name\}/gi, name)
    .replace(/\{ten\}/gi, name);
}

// ── Strict Fanpage Source Resolution (No Arbitrary Fallback) ──

/**
 * Resolves the exact Fanpage inbox source that owns a given thread.
 * Never falls back to an unrelated active Fanpage when the owning Page
 * has lost its token or when the thread belongs to a personal Facebook account.
 * @param {object} thread
 * @param {Array<object>} inboxSources
 * @returns {{ ok: boolean, source?: object, code?: string, error?: string }}
 */
export function resolveThreadPageSource(thread, inboxSources) {
  if (!thread) {
    return { ok: false, code: 'THREAD_NOT_FOUND', error: 'Không tìm thấy hội thoại Fanpage.' };
  }

  const sourceId = String(thread.source_id || '').trim();
  const sourceType = String(thread.source_type || '').trim();
  if (sourceType === 'personal_messenger' || sourceId.startsWith('src_personal_')) {
    return {
      ok: false,
      code: 'PERSONAL_THREAD_UNSUPPORTED_STANDALONE',
      error: 'Hội thoại Facebook cá nhân cần kết nối App Desktop để gửi tin. Chế độ Mobile độc lập chỉ hỗ trợ gửi trực tiếp qua Fanpage.'
    };
  }

  const sources = Array.isArray(inboxSources) ? inboxSources : [];
  const pageSources = sources.filter((s) => s && s.source_type === 'page_messenger');

  let matched = null;
  if (sourceId) {
    matched = pageSources.find((s) => String(s.id) === sourceId) || null;
  }

  const extId = String(thread.source_external_id || '').trim();
  if (!matched && extId) {
    matched = pageSources.find((s) => String(s.external_id) === extId) || null;
  }

  if (!matched && typeof thread.id === 'string' && thread.id.startsWith('page:')) {
    const parts = thread.id.split(':');
    const embeddedPageId = String(parts[1] || '').trim();
    if (embeddedPageId) {
      matched = pageSources.find((s) => String(s.external_id) === embeddedPageId) || null;
    }
  }

  if (!matched) {
    return {
      ok: false,
      code: 'PAGE_SOURCE_NOT_FOUND',
      error: 'Không xác định được Fanpage sở hữu hội thoại này. Vui lòng đồng bộ lại từ App Desktop.'
    };
  }

  if (matched.status && matched.status !== 'ACTIVE') {
    const label = matched.display_name || matched.external_id || 'Fanpage';
    return {
      ok: false,
      code: 'PAGE_SOURCE_INACTIVE',
      error: `Fanpage "${label}" đã ngắt kết nối hoặc hết hạn token. Vui lòng đồng bộ lại từ App Desktop hoặc nhập lại Token.`
    };
  }

  if (!matched.token) {
    const label = matched.display_name || matched.external_id || 'Fanpage';
    return {
      ok: false,
      code: 'PAGE_TOKEN_MISSING',
      error: `Fanpage "${label}" chưa có Page Access Token. Vui lòng đồng bộ lại từ App Desktop hoặc nhập Token.`
    };
  }

  return { ok: true, source: matched };
}

