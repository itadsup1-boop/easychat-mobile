import { getMachineId, getStoredLicenseKey, setStoredLicenseKey } from './utils/machineId.js';

const LICENSE_SERVER_BASE = 'https://genblackmmoonline.online/license_server';
const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const STORAGE_KEY = 'easychat_mobile_store_v1';
const USER_STORAGE_KEY = 'easychat_mobile_user_v1';

const DEFAULT_LEAD_STATUSES = [
  { id: 1, name: 'Khách mới', color: '#0ea5e9', sort_order: 1 },
  { id: 2, name: 'Đang tư vấn', color: '#f59e0b', sort_order: 2 },
  { id: 3, name: 'Đã xin SĐT', color: '#8b5cf6', sort_order: 3 },
  { id: 4, name: 'Đã chốt đơn', color: '#10b981', sort_order: 4 },
  { id: 5, name: 'Cần gọi lại', color: '#ef4444', sort_order: 5 }
];

function isExpiredFbCdnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const match = url.match(/[?&]oe=([0-9a-fA-F]{8})(?:&|$)/);
  if (!match) return false;
  const expMs = parseInt(match[1], 16) * 1000;
  return expMs > 1577836800000 && expMs < Date.now();
}

function sanitizeMobileAvatarUrl(rawUrl, { isPageSource = false, pageExternalId = '' } = {}) {
  if (isPageSource && pageExternalId) {
    const str = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (/^https?:\/\//i.test(str) && !isExpiredFbCdnUrl(str)) return str;
    return `https://graph.facebook.com/${pageExternalId}/picture?type=normal`;
  }
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (isExpiredFbCdnUrl(trimmed)) return null;
  if (/graph\.facebook\.com\/(?:v[\d.]+\/)?\d+\/picture/i.test(trimmed) && trimmed.includes('access_token=')) {
    return null;
  }
  return trimmed;
}

function normalizeLoadedStore(data) {
  const next = {
    inboxSources: Array.isArray(data.inboxSources) ? data.inboxSources : [],
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    desktopLanIps: Array.isArray(data.desktopLanIps) ? data.desktopLanIps : [],
    threads: Array.isArray(data.threads) ? data.threads : [],
    messagesByThread: data.messagesByThread && typeof data.messagesByThread === 'object' ? { ...data.messagesByThread } : {},
    contactsByThread: data.contactsByThread && typeof data.contactsByThread === 'object' ? { ...data.contactsByThread } : {},
    leadStatuses: Array.isArray(data.leadStatuses) && data.leadStatuses.length ? data.leadStatuses : DEFAULT_LEAD_STATUSES,
    quickTemplates: Array.isArray(data.quickTemplates) ? data.quickTemplates : [],
    autoReplyRules: Array.isArray(data.autoReplyRules) ? data.autoReplyRules : [],
    campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
    employees: Array.isArray(data.employees) ? data.employees : [],
    aiConfig: data.aiConfig || { enabled: false, provider: 'openai', model: 'gpt-4o-mini', system_prompt: '' },
    phoneAutomation: data.phoneAutomation || { enabled: true, policy: 'continue', thank_you_text: '', target_status_id: null },
    pageBridgeConfig: data.pageBridgeConfig || { bridge_url: 'https://genblackmmoonline.online/webhook.php', verify_token: 'crmwb_mobile_verify' }
  };

  next.inboxSources = next.inboxSources.map((s) => ({
    ...s,
    avatar_url: sanitizeMobileAvatarUrl(s.avatar_url, {
      isPageSource: s.source_type === 'page_messenger',
      pageExternalId: String(s.external_id || '')
    })
  }));

  next.accounts = next.accounts.map((a) => ({
    ...a,
    avatar_url: sanitizeMobileAvatarUrl(a.avatar_url)
  }));

  for (const tid of Object.keys(next.messagesByThread)) {
    const arr = Array.isArray(next.messagesByThread[tid]) ? next.messagesByThread[tid] : [];
    next.messagesByThread[tid] = arr.map((m) => (
      m && typeof m.message === 'object' && m.message !== null && m.content === undefined
        ? { ...m, ...m.message }
        : m
    ));
  }

  const canonicalByPagePsid = new Map();
  for (const t of next.threads) {
    const tid = String(t.id || '');
    if (!tid.startsWith('page:')) {
      const psid = String(t.external_thread_id || tid);
      const srcKey = String(t.source_id || t.source_external_id || '');
      if (srcKey && psid) canonicalByPagePsid.set(`${srcKey}:${psid}`, tid);
    }
  }

  const dedupedThreads = [];
  const seenThreadIds = new Set();
  for (const rawThread of next.threads) {
    const tid = String(rawThread.id || '');
    if (!tid) continue;
    if (tid.startsWith('page:')) {
      const parts = tid.split(':');
      const pageExtId = parts[1] || '';
      const psid = parts.slice(2).join(':') || String(rawThread.external_thread_id || '');
      const canonicalTid = canonicalByPagePsid.get(`${String(rawThread.source_id || '')}:${psid}`)
        || canonicalByPagePsid.get(`${pageExtId}:${psid}`);
      if (canonicalTid && canonicalTid !== tid) {
        const dupMsgs = next.messagesByThread[tid] || [];
        if (dupMsgs.length) {
          const baseMsgs = next.messagesByThread[canonicalTid] || [];
          const byMsgId = new Map();
          for (const m of [...baseMsgs, ...dupMsgs]) {
            byMsgId.set(String(m.fb_message_id || m.client_message_id || m.id), { ...m, thread_id: canonicalTid });
          }
          next.messagesByThread[canonicalTid] = Array.from(byMsgId.values()).sort(
            (a, b) => (Number(a.timestamp_ms) || 0) - (Number(b.timestamp_ms) || 0)
          );
          delete next.messagesByThread[tid];
        }
        continue;
      }
    }
    if (seenThreadIds.has(tid)) continue;
    seenThreadIds.add(tid);
    const pinnedVal = Number(rawThread.pinned ?? rawThread.is_pinned ?? 0) ? 1 : 0;
    dedupedThreads.push({
      ...rawThread,
      avatar_url: sanitizeMobileAvatarUrl(rawThread.avatar_url),
      pinned: pinnedVal,
      is_pinned: pinnedVal
    });
  }
  next.threads = dedupedThreads;

  for (const tid of Object.keys(next.contactsByThread)) {
    const c = next.contactsByThread[tid];
    if (c && typeof c === 'object') {
      next.contactsByThread[tid] = {
        ...c,
        avatar_url: sanitizeMobileAvatarUrl(c.avatar_url)
      };
    }
  }

  return next;
}

function loadStore() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeLoadedStore(JSON.parse(raw));
    }
  } catch (_) {}
  return normalizeLoadedStore({});
}

let store = loadStore();
const stagedFiles = new Map(); // attachment_id -> { id, file, preview_url, media_type, name, size, mime_type }
let activeOpenThreadId = null;
const profileCheckedAt = new Map(); // psid -> timestampMs
const profileInFlight = new Set();

async function sha256Bytes(inputStr) {
  const data = new TextEncoder().encode(String(inputStr || ''));
  const hashBuf = await window.crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuf);
}

async function sha256Hex(inputStr) {
  const bytes = await sha256Bytes(inputStr);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function xorDecipherBase64(cipherB64, secret) {
  if (!cipherB64) return '';
  try {
    const binStr = atob(String(cipherB64));
    const keyBytes = await sha256Bytes(String(secret || 'easychat'));
    const out = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      out[i] = (binStr.charCodeAt(i) & 0xff) ^ keyBytes[i % keyBytes.length];
    }
    return new TextDecoder().decode(out);
  } catch (_) {
    return '';
  }
}

export async function syncFromDesktopToMobile(nativeFetch = window._easychatNativeFetch || window.fetch) {
  const user = getSavedUser();
  const username = String(user?.username || user?.email || '').trim().toLowerCase();
  const licenseKey = String(getStoredLicenseKey() || '').trim();
  if (!username) {
    throw new Error('Vui lòng đăng nhập tài khoản trước khi đồng bộ.');
  }

  let snapshot = null;
  let sourceLabel = '';

  // Layer 1: Cloud Sync via Central License Server (license_server1)
  try {
    const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/cloud-sync/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, licenseKey })
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (data?.success && data?.snapshot) {
        snapshot = data.snapshot;
        sourceLabel = data.live_from_desktop ? 'trực tiếp từ PC qua Cloud' : 'từ bản sao Cloud của PC';
      }
    }
  } catch (_) {}

  // Layer 2: Cloud Snapshot Branch (mobile-sync-data on GitHub)
  if (!snapshot) {
    const syncHash = (await sha256Hex(`${username}|${licenseKey.toUpperCase()}`)).slice(0, 24);
    const userHash = (await sha256Hex(`easychat_user|${username}`)).slice(0, 24);
    const candidateUrls = [
      `https://raw.githubusercontent.com/itadsup1-boop/CRM_FB_Mobile/mobile-sync-data/snapshots/${syncHash}.json?t=${Date.now()}`,
      `https://raw.githubusercontent.com/itadsup1-boop/CRM_FB_Mobile/mobile-sync-data/snapshots/user_${userHash}.json?t=${Date.now()}`
    ];
    for (const ghUrl of candidateUrls) {
      try {
        const resp = await nativeFetch(ghUrl);
        if (resp.ok) {
          const parsed = await resp.json().catch(() => null);
          if (parsed && Array.isArray(parsed.threads)) {
            snapshot = parsed;
            sourceLabel = 'từ Cloud Sync của App Desktop';
            break;
          }
        }
      } catch (_) {}
    }
  }

  // Layer 3: Direct LAN IP fallback if on the same Wi-Fi network or Android Emulator (LDPlayer) as PC
  if (!snapshot) {
    const lanCandidates = ['192.168.1.182', '10.0.2.2', ...(store.desktopLanIps || [])];
    for (const ip of [...new Set(lanCandidates)]) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const resp = await nativeFetch(
          `http://${ip}:5050/api/desktop-sync/export?username=${encodeURIComponent(username)}&key=${encodeURIComponent(licenseKey)}`,
          { signal: ctrl.signal }
        ).finally(() => clearTimeout(t));
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          if (data?.success && data?.snapshot) {
            snapshot = data.snapshot;
            sourceLabel = `trực tiếp từ PC (${ip})`;
            break;
          }
        }
      } catch (_) {}
    }
  }

  if (!snapshot) {
    throw new Error('Chưa tìm thấy dữ liệu đồng bộ từ App Desktop của tài khoản ' + username + '. Hãy mở App EasyChat trên PC để đẩy dữ liệu đồng bộ.');
  }

  // Decrypt Page Access Tokens and merge Desktop data into Mobile store
  const secretPrimary = `${username}:${licenseKey}`;
  const secretFallback = `${String(snapshot.desktop_username || username).toLowerCase()}:${licenseKey}`;

  if (Array.isArray(snapshot.lan_ips) && snapshot.lan_ips.length) {
    store.desktopLanIps = snapshot.lan_ips;
  }
  if (Array.isArray(snapshot.accounts) && snapshot.accounts.length) {
    store.accounts = snapshot.accounts.map((a) => ({
      ...a,
      is_extension_connected: true
    }));
  }
  if (Array.isArray(snapshot.inboxSources)) {
    const mergedSources = [];
    for (const src of snapshot.inboxSources) {
      let token = src.token || '';
      if (!token && src.token_cipher) {
        token = await xorDecipherBase64(src.token_cipher, secretPrimary);
        if (!token || !token.startsWith('EA')) {
          token = await xorDecipherBase64(src.token_cipher, secretFallback);
        }
      }
      const prev = store.inboxSources.find((s) => String(s.id) === String(src.id) || String(s.external_id) === String(src.external_id));
      mergedSources.push({
        ...src,
        token: (token && token.startsWith('EA')) ? token : (prev?.token || ''),
        access_token_encrypted: 'mobile_local'
      });
    }
    store.inboxSources = mergedSources;
  }
  if (snapshot.pageBridgeConfig) {
    store.pageBridgeConfig = { ...store.pageBridgeConfig, ...snapshot.pageBridgeConfig };
  }
  if (Array.isArray(snapshot.leadStatuses) && snapshot.leadStatuses.length) {
    store.leadStatuses = snapshot.leadStatuses;
  }
  if (Array.isArray(snapshot.quickTemplates)) {
    store.quickTemplates = snapshot.quickTemplates;
  }
  if (Array.isArray(snapshot.autoReplyRules)) {
    store.autoReplyRules = snapshot.autoReplyRules;
  }
  if (snapshot.contactsByThread && typeof snapshot.contactsByThread === 'object') {
    store.contactsByThread = { ...snapshot.contactsByThread };
  }
  if (snapshot.messagesByThread && typeof snapshot.messagesByThread === 'object') {
    const nextMessages = {};
    for (const [tid, msgs] of Object.entries(snapshot.messagesByThread)) {
      if (!Array.isArray(msgs)) continue;
      const byId = new Map();
      for (const m of msgs) byId.set(String(m.fb_message_id || m.id), m);
      nextMessages[tid] = Array.from(byId.values()).sort((a, b) => (Number(a.timestamp_ms) || 0) - (Number(b.timestamp_ms) || 0));
    }
    store.messagesByThread = nextMessages;
  }
  if (Array.isArray(snapshot.threads)) {
    const nextThreads = [];
    const seen = new Set();
    for (const t of snapshot.threads) {
      const tid = String(t.id);
      if (seen.has(tid)) continue;
      seen.add(tid);
      const msgs = store.messagesByThread[tid] || [];
      const lastMsgTs = msgs.length ? Number(msgs[msgs.length - 1]?.timestamp_ms || 0) : (Date.parse(t.last_activity || '') || Date.now());
      nextThreads.push({
        ...t,
        last_msg_ts: lastMsgTs
      });
    }
    store.threads = nextThreads;
  }

  store = normalizeLoadedStore(store);
  saveStore();

  // Also trigger live Graph API sync for any imported Fanpages with tokens
  for (const src of store.inboxSources) {
    if (src.source_type === 'page_messenger' && src.status === 'ACTIVE' && src.token) {
      syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 25, msgLimit: 30, broadcastRealtime: true }).catch(() => {});
    }
  }

  const summary = {
    success: true,
    source_label: sourceLabel,
    exported_at: snapshot.exported_at,
    threads_count: store.threads.length,
    pages_count: store.inboxSources.filter((s) => s.source_type === 'page_messenger').length
  };
  broadcastMobileSocket('THREADS_UPDATED', summary);
  broadcastMobileSocket('THREAD_LIST_UPDATED', summary);
  broadcastMobileSocket('DESKTOP_SYNC_COMPLETED', summary);
  return summary;
}

function saveStore() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('[MobileEngine] Storage quota warning, trimming old messages:', err?.message);
    try {
      for (const tid of Object.keys(store.messagesByThread)) {
        if (store.messagesByThread[tid]?.length > 60) {
          store.messagesByThread[tid] = store.messagesByThread[tid].slice(-60);
        }
      }
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (_) {}
  }
}

function getSavedUser() {
  try {
    const raw = window.localStorage?.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function setSavedUser(user) {
  try {
    if (user) window.localStorage?.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else window.localStorage?.removeItem(USER_STORAGE_KEY);
  } catch (_) {}
}

// Public aliases for AuthScreen (mobile standalone auth)
export function getSavedMobileUser() { return getSavedUser(); }
export function setSavedMobileUser(user) { setSavedUser(user); }

// ── Virtual Socket Bus for Real-Time UI Updates on Mobile ──
class VirtualMobileSocket {
  constructor() {
    this.id = 'mobile_virtual_' + Math.random().toString(36).slice(2, 9);
    this.connected = true;
    this.listeners = new Map();
    setTimeout(() => this._trigger('connect'), 20);
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return this;
  }
  off(event, fn) {
    if (!event) {
      this.listeners.clear();
      return this;
    }
    const set = this.listeners.get(event);
    if (set) {
      if (fn) set.delete(fn);
      else set.clear();
    }
    return this;
  }
  emit(event, payload, ack) {
    handleClientSocketEmit(event, payload, ack);
    return this;
  }
  _trigger(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error('[VirtualSocket]', e); }
    }
  }
  close() {}
}

const activeSockets = new Set();
export function createVirtualMobileSocket() {
  const sock = new VirtualMobileSocket();
  activeSockets.add(sock);
  const origClose = sock.close.bind(sock);
  sock.close = () => {
    activeSockets.delete(sock);
    origClose();
  };
  return sock;
}

export function broadcastMobileSocket(event, payload) {
  for (const sock of activeSockets) {
    sock._trigger(event, payload);
  }
}

function extractPhoneFromText(text) {
  const m = String(text || '').replace(/[\s.\-()]/g, '').match(/(?:\+84|84|0)(3|5|7|8|9)\d{8}\b/);
  if (!m) return null;
  return '0' + m[0].replace(/^(?:\+84|84|0)/, '');
}

// ── Facebook Graph API Helpers for Messenger Page ──
async function graphFetch(nativeFetch, path, params = {}, options = {}) {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const url = new URL(`${GRAPH_API_BASE}/${cleanPath}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const resp = await nativeFetch(url.toString(), options);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    throw new Error(data.error?.message || `Graph API HTTP ${resp.status}`);
  }
  return data;
}

function parseGraphMessage(msgNode, pageId, threadId, customerName) {
  const fromId = String(msgNode?.from?.id || '');
  const isOutgoing = fromId === String(pageId);
  const createdMs = Date.parse(msgNode?.created_time || '') || Date.now();
  let mediaType = 'text';
  let mediaUrl = null;
  const att = msgNode?.attachments?.data?.[0];
  if (att) {
    const rawType = String(att.type || '').toLowerCase();
    if (rawType.includes('video') || att.video_data) {
      mediaType = 'video';
      mediaUrl = att.video_data?.url || att.file_url || att.image_data?.url || null;
    } else if (rawType.includes('image') || rawType.includes('photo') || att.image_data) {
      mediaType = 'image';
      mediaUrl = att.image_data?.url || att.file_url || null;
    } else if (rawType.includes('audio')) {
      mediaType = 'audio';
      mediaUrl = att.file_url || null;
    } else if (att.file_url) {
      mediaType = 'file';
      mediaUrl = att.file_url;
    }
  } else if (msgNode?.sticker) {
    mediaType = 'image';
    mediaUrl = msgNode.sticker;
  }
  const textContent = String(msgNode?.message || '').trim();
  return {
    id: msgNode.id,
    fb_message_id: msgNode.id,
    thread_id: threadId,
    sender_id: fromId || (isOutgoing ? pageId : 'CONTACT'),
    sender_name: isOutgoing ? 'Bạn' : (msgNode?.from?.name || customerName || 'Khách hàng'),
    content: textContent,
    media_type: mediaType,
    media_url: mediaUrl,
    is_outgoing: isOutgoing ? 1 : 0,
    sender_role: isOutgoing ? 'operator' : 'customer',
    direction_status: 'confirmed',
    status: 'sent',
    delivery_status: 'sent',
    timestamp_ms: createdMs,
    sequence_order: createdMs,
    created_at: new Date(createdMs).toISOString()
  };
}

function findExistingPageThreadIndex(source, pageId, psid) {
  const srcIdStr = String(source?.id || '');
  const prefixedId = `page:${pageId}:${psid}`;
  // 1. Exact match on source + (bare psid or external_thread_id or page:<pid>:<psid>)
  const bySourceIdx = store.threads.findIndex((t) => {
    const sameSource = (srcIdStr && String(t.source_id || '') === srcIdStr)
      || String(t.source_external_id || '') === pageId;
    if (!sameSource) return false;
    const tid = String(t.id || '');
    const ext = String(t.external_thread_id || '');
    return tid === psid || ext === psid || tid === prefixedId;
  });
  if (bySourceIdx >= 0) return bySourceIdx;
  // 2. Fallback match on page:<pid>:<psid> or bare psid for page_messenger
  return store.threads.findIndex((t) => {
    const tid = String(t.id || '');
    if (tid === prefixedId) return true;
    return t.source_type === 'page_messenger' && tid === psid && !t.source_external_id;
  });
}

async function enrichCustomerProfileOnMobile(nativeFetch, source, threadId, psid) {
  if (!source?.token || !psid || !threadId) return;
  const key = `${source.external_id}:${psid}`;
  if (profileInFlight.has(key)) return;
  const lastChecked = profileCheckedAt.get(key) || 0;
  if (Date.now() - lastChecked < 30 * 60 * 1000) return;

  profileInFlight.add(key);
  profileCheckedAt.set(key, Date.now());
  try {
    const data = await graphFetch(nativeFetch, String(psid), {
      fields: 'first_name,last_name,profile_pic',
      access_token: source.token
    });
    const fullName = [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim() || null;
    const profilePic = sanitizeMobileAvatarUrl(data?.profile_pic);
    if (!fullName && !profilePic) return;

    let changed = false;
    const idx = store.threads.findIndex((t) => String(t.id) === String(threadId));
    if (idx >= 0) {
      const cur = store.threads[idx];
      const nextAvatar = profilePic || cur.avatar_url || null;
      const curName = String(cur.contact_name || '').trim();
      const shouldUpdateName = fullName && (!curName || /^Khách hàng/i.test(curName));
      if (nextAvatar !== cur.avatar_url || shouldUpdateName) {
        store.threads[idx] = {
          ...cur,
          avatar_url: nextAvatar,
          ...(shouldUpdateName ? { contact_name: fullName } : {})
        };
        changed = true;
      }
    }
    const curContact = store.contactsByThread[threadId] || { thread_id: threadId };
    if (profilePic && curContact.avatar_url !== profilePic) {
      store.contactsByThread[threadId] = {
        ...curContact,
        ...(fullName && !curContact.name ? { name: fullName } : {}),
        avatar_url: profilePic
      };
      changed = true;
    }
    if (changed) {
      saveStore();
      broadcastMobileSocket('CONTACT_UPDATED', {
        thread_id: threadId,
        ...(fullName ? { name: fullName } : {}),
        ...(profilePic ? { avatar_url: profilePic } : {})
      });
    }
  } catch (_) {
    // PSID profile lookup may fail if user privacy restricts Messenger profile_pic; keep initials fallback
  } finally {
    profileInFlight.delete(key);
  }
}

export async function syncPageConversationsOnMobile(nativeFetch, source, options = {}) {
  if (!source || !source.token || source.status !== 'ACTIVE') return { syncedThreads: 0, newMessages: 0 };
  const pageId = String(source.external_id);
  const pageToken = source.token;
  const convLimit = options.convLimit || 25;
  const msgLimit = options.msgLimit || 30;

  const data = await graphFetch(nativeFetch, `${pageId}/conversations`, {
    fields: `participants,updated_time,unread_count,messages.limit(${msgLimit}){id,message,created_time,from,to,attachments{id,type,mime_type,name,size,file_url,image_data,video_data},sticker}`,
    limit: convLimit,
    access_token: pageToken
  });

  const convList = Array.isArray(data?.data) ? data.data : [];
  let syncedThreads = 0;
  let newMessagesCount = 0;

  for (const conv of convList) {
    const participants = Array.isArray(conv?.participants?.data) ? conv.participants.data : [];
    const customer = participants.find((p) => String(p.id) !== pageId) || participants[0] || {};
    const psid = String(customer.id || conv.id || '');
    if (!psid) continue;

    const existingThreadIdx = findExistingPageThreadIndex(source, pageId, psid);
    const existingThread = existingThreadIdx >= 0 ? store.threads[existingThreadIdx] : null;
    const bareIdTakenByOther = !existingThread && store.threads.some((t) => String(t.id) === psid);
    const threadId = existingThread
      ? String(existingThread.id)
      : (bareIdTakenByOther ? `page:${pageId}:${psid}` : psid);

    const customerName = String(customer.name || 'Khách hàng Fanpage').trim();
    const updatedMs = Date.parse(conv.updated_time || '') || Date.now();

    const rawMsgs = Array.isArray(conv?.messages?.data) ? conv.messages.data.slice().reverse() : [];
    const parsedMsgs = rawMsgs.map((m) => parseGraphMessage(m, pageId, threadId, customerName));

    const existingMsgs = (store.messagesByThread[threadId] || []).slice();
    const existingIds = new Set(existingMsgs.map((m) => String(m.fb_message_id || m.id)));
    let maxExistingSeq = existingMsgs.reduce((mx, m) => Math.max(mx, Number(m?.sequence_order ?? m?.id) || 0), 0);
    const newlyArrived = [];

    for (const pm of parsedMsgs) {
      if (!existingIds.has(String(pm.fb_message_id))) {
        const nextSeq = Math.max(Number(pm.sequence_order) || 0, maxExistingSeq + 1);
        maxExistingSeq = nextSeq;
        const enrichedPm = { ...pm, thread_id: threadId, sequence_order: nextSeq };
        existingMsgs.push(enrichedPm);
        existingIds.add(String(pm.fb_message_id));
        newlyArrived.push(enrichedPm);
        newMessagesCount += 1;
        if (!enrichedPm.is_outgoing && enrichedPm.content) {
          const detectedPhone = extractPhoneFromText(enrichedPm.content);
          if (detectedPhone) {
            const existingContact = store.contactsByThread[threadId] || {};
            if (!existingContact.phone) {
              store.contactsByThread[threadId] = {
                ...existingContact,
                thread_id: threadId,
                name: customerName,
                phone: detectedPhone,
                phone_captured_at: new Date().toISOString()
              };
            }
          }
        }
      }
    }

    existingMsgs.sort((a, b) => (Number(a.timestamp_ms) || 0) - (Number(b.timestamp_ms) || 0));
    store.messagesByThread[threadId] = existingMsgs;

    const lastMsgObj = existingMsgs[existingMsgs.length - 1] || null;
    const lastPreview = lastMsgObj
      ? (lastMsgObj.content
          ? (lastMsgObj.is_outgoing ? `Bạn: ${lastMsgObj.content}` : lastMsgObj.content)
          : (lastMsgObj.media_type === 'video' ? '[Video]' : '[Ảnh]'))
      : 'Chưa có tin nhắn';

    const contactRecord = store.contactsByThread[threadId] || {};
    const validAvatar = sanitizeMobileAvatarUrl(contactRecord.avatar_url || existingThread?.avatar_url);
    const pinnedVal = Number(existingThread?.pinned ?? existingThread?.is_pinned ?? 0) ? 1 : 0;
    const isCurrentlyOpen = String(activeOpenThreadId || '') === threadId;

    const nextThread = {
      ...(existingThread || {}),
      id: threadId,
      external_thread_id: psid,
      conversation_graph_id: conv.id,
      account_id: existingThread?.account_id || source.owner_account_id || 'page_workspace',
      source_id: source.id,
      source_type: 'page_messenger',
      source_name: source.display_name,
      source_external_id: pageId,
      source_status: source.status,
      contact_name: contactRecord.name || existingThread?.contact_name || customerName,
      nickname: contactRecord.nickname || existingThread?.nickname || null,
      avatar_url: validAvatar,
      phone: contactRecord.phone || existingThread?.phone || null,
      last_message: lastPreview,
      last_activity: new Date(lastMsgObj?.timestamp_ms || updatedMs).toISOString(),
      last_msg_ts: lastMsgObj?.timestamp_ms || updatedMs,
      is_unread: isCurrentlyOpen
        ? 0
        : (existingThread
            ? (newlyArrived.some((m) => !m.is_outgoing) ? 1 : Number(existingThread.is_unread || 0))
            : (Number(conv.unread_count) > 0 ? 1 : 0)),
      status: existingThread?.status || 'UNPROCESSED',
      lead_status_id: contactRecord.lead_status_id ?? existingThread?.lead_status_id ?? null,
      is_vip: contactRecord.is_vip ?? existingThread?.is_vip ?? 0,
      pinned: pinnedVal,
      is_pinned: pinnedVal,
      inbox_folder: existingThread?.inbox_folder || 'INBOX',
      archived_at: existingThread?.archived_at || null,
      reminder_due_at: existingThread?.reminder_due_at || null,
      reminder_note: existingThread?.reminder_note || null
    };

    if (existingThreadIdx >= 0) {
      store.threads[existingThreadIdx] = nextThread;
    } else {
      store.threads.push(nextThread);
    }

    if (!store.contactsByThread[threadId]) {
      store.contactsByThread[threadId] = {
        thread_id: threadId,
        name: customerName,
        avatar_url: validAvatar,
        phone: nextThread.phone || '',
        email: '',
        address: '',
        notes: '',
        is_vip: 0,
        lead_status_id: null
      };
    }

    if (!validAvatar && (isCurrentlyOpen || newlyArrived.length > 0)) {
      enrichCustomerProfileOnMobile(nativeFetch, source, threadId, psid).catch(() => {});
    }

    syncedThreads += 1;

    if (newlyArrived.length > 0 && options.broadcastRealtime) {
      for (const nm of newlyArrived) {
        broadcastMobileSocket('NEW_MESSAGE', {
          ...nm,
          thread_id: threadId,
          account_id: nextThread.account_id,
          source_id: source.id,
          source_type: 'page_messenger',
          source_name: source.display_name,
          page_id: pageId,
          thread_summary: nextThread
        });
      }
      broadcastMobileSocket('THREAD_MESSAGES_UPDATED', {
        thread_id: threadId,
        account_id: nextThread.account_id,
        messages: existingMsgs,
        authoritative: true
      });
      broadcastMobileSocket('THREAD_LIST_UPDATED', {
        thread_id: threadId,
        account_id: nextThread.account_id,
        new_messages: newlyArrived.length,
        page_id: pageId
      });
    }
  }

  saveStore();
  if (newMessagesCount > 0) {
    broadcastMobileSocket('THREAD_LIST_UPDATED', {
      account_id: source.owner_account_id || null,
      new_messages: newMessagesCount,
      page_id: pageId
    });
  }
  return { syncedThreads, newMessages: newMessagesCount };
}

async function sendPageMessageOnMobile(nativeFetch, { threadId, content, attachmentIds = [], clientMessageId }) {
  const thread = store.threads.find((t) => String(t.id) === String(threadId));
  if (!thread) throw new Error('Không tìm thấy hội thoại Fanpage');
  const source = store.inboxSources.find((s) => String(s.id) === String(thread.source_id))
    || store.inboxSources.find((s) => s.source_type === 'page_messenger' && String(s.external_id) === String(thread.source_external_id || '') && s.token)
    || store.inboxSources.find((s) => s.source_type === 'page_messenger' && s.status === 'ACTIVE' && s.token);
  if (!source || !source.token) {
    throw new Error('Fanpage chưa có Page Access Token. Vui lòng đồng bộ lại từ App Desktop hoặc nhập Token.');
  }

  const pageId = String(source.external_id);
  const psid = String(thread.external_thread_id || String(threadId).split(':').pop());
  const createdMessages = [];
  const existingList = store.messagesByThread[thread.id] || [];
  let maxSeq = existingList.reduce((mx, m) => Math.max(mx, Number(m?.sequence_order ?? m?.id) || 0), 0);

  // 1. Send attachments first if any
  for (const attId of attachmentIds) {
    const staged = stagedFiles.get(String(attId));
    if (!staged || !staged.file) continue;
    const form = new FormData();
    form.append('recipient', JSON.stringify({ id: psid }));
    form.append('messaging_type', 'RESPONSE');
    form.append('message', JSON.stringify({
      attachment: {
        type: staged.media_type === 'video' ? 'video' : (staged.media_type === 'image' ? 'image' : 'file'),
        payload: { is_reusable: true }
      }
    }));
    form.append('filedata', staged.file, staged.name || 'upload');

    const uploadUrl = `${GRAPH_API_BASE}/${pageId}/messages?access_token=${encodeURIComponent(source.token)}`;
    const resp = await nativeFetch(uploadUrl, { method: 'POST', body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) {
      throw new Error(data.error?.message || 'Không gửi được tệp đính kèm qua Graph API');
    }
    const mid = data.message_id || `m_att_${Date.now()}`;
    const nowMs = Date.now();
    maxSeq = Math.max(nowMs, maxSeq + 1);
    const attMsg = {
      id: mid,
      fb_message_id: mid,
      client_message_id: clientMessageId || `client_${nowMs}`,
      attachment_id: attId,
      thread_id: thread.id,
      sender_id: pageId,
      sender_name: 'Bạn',
      content: '',
      media_type: staged.media_type || 'image',
      media_url: staged.preview_url,
      is_outgoing: 1,
      sender_role: 'operator',
      direction_status: 'confirmed',
      status: 'sent',
      delivery_status: 'sent',
      timestamp_ms: nowMs,
      sequence_order: maxSeq,
      created_at: new Date(nowMs).toISOString()
    };
    if (!store.messagesByThread[thread.id]) store.messagesByThread[thread.id] = [];
    store.messagesByThread[thread.id].push(attMsg);
    createdMessages.push(attMsg);
    thread.last_message = staged.media_type === 'video' ? 'Bạn: [Video]' : 'Bạn: [Ảnh]';
    thread.last_activity = new Date(nowMs).toISOString();
    thread.last_msg_ts = nowMs;
  }

  // 2. Send text content if any
  const text = String(content || '').trim();
  if (text) {
    const sendUrl = `${GRAPH_API_BASE}/${pageId}/messages?access_token=${encodeURIComponent(source.token)}`;
    const resp = await nativeFetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        messaging_type: 'RESPONSE',
        message: { text }
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) {
      throw new Error(data.error?.message || 'Không gửi được tin nhắn Fanpage');
    }
    const mid = data.message_id || `m_${Date.now()}`;
    const nowMs = Date.now();
    maxSeq = Math.max(nowMs, maxSeq + 1);
    const txtMsg = {
      id: mid,
      fb_message_id: mid,
      client_message_id: clientMessageId || `client_${nowMs}`,
      thread_id: thread.id,
      sender_id: pageId,
      sender_name: 'Bạn',
      content: text,
      media_type: 'text',
      media_url: null,
      is_outgoing: 1,
      sender_role: 'operator',
      direction_status: 'confirmed',
      status: 'sent',
      delivery_status: 'sent',
      timestamp_ms: nowMs,
      sequence_order: maxSeq,
      created_at: new Date(nowMs).toISOString()
    };
    if (!store.messagesByThread[thread.id]) store.messagesByThread[thread.id] = [];
    store.messagesByThread[thread.id].push(txtMsg);
    createdMessages.push(txtMsg);
    thread.last_message = `Bạn: ${text}`;
    thread.last_activity = new Date(nowMs).toISOString();
    thread.last_msg_ts = nowMs;
  }

  thread.is_unread = 0;
  saveStore();
  for (const m of createdMessages) {
    broadcastMobileSocket('MESSAGE_SENT', {
      thread_id: thread.id,
      client_message_id: m.client_message_id,
      fb_message_id: m.fb_message_id,
      provisional: false
    });
    broadcastMobileSocket('NEW_MESSAGE', {
      ...m,
      thread_id: thread.id,
      account_id: thread.account_id,
      source_id: thread.source_id,
      source_type: 'page_messenger',
      source_name: source.display_name,
      page_id: pageId,
      thread_summary: thread
    });
  }
  broadcastMobileSocket('THREAD_LIST_UPDATED', {
    thread_id: thread.id,
    account_id: thread.account_id,
    page_id: pageId
  });
  return createdMessages;
}

function handleClientSocketEmit(event, payload = {}, ack) {
  const nativeFetch = window._easychatNativeFetch || window.fetch;
  if (event === 'SEND_MESSAGE') {
    sendPageMessageOnMobile(nativeFetch, {
      threadId: payload.thread_id,
      content: payload.content || payload.text,
      attachmentIds: payload.attachment_ids || (payload.attachment_id ? [payload.attachment_id] : []),
      clientMessageId: payload.client_message_id
    })
      .then((msgs) => {
        ack?.({ success: true, messages: msgs });
      })
      .catch((err) => {
        broadcastMobileSocket('MESSAGE_SEND_FAILED', {
          thread_id: payload.thread_id,
          client_message_id: payload.client_message_id,
          error: err.message
        });
        ack?.({ success: false, error: err.message });
      });
    return;
  }
  if (event === 'REQUEST_THREAD_HISTORY_SYNC' || event === 'RESYNC_THREAD') {
    const tid = String(payload.thread_id || '');
    if (tid) activeOpenThreadId = tid;
    const thread = store.threads.find((t) => String(t.id) === tid);
    const source = store.inboxSources.find((s) => String(s.id) === String(thread?.source_id))
      || store.inboxSources.find((s) => s.source_type === 'page_messenger' && String(s.external_id) === String(thread?.source_external_id || '') && s.token);
    if (source) {
      syncPageConversationsOnMobile(nativeFetch, source, { convLimit: 25, msgLimit: 50, broadcastRealtime: true })
        .then(() => {
          broadcastMobileSocket('THREAD_MESSAGES_UPDATED', {
            thread_id: tid,
            account_id: thread?.account_id || null,
            messages: store.messagesByThread[tid] || [],
            authoritative: true
          });
        })
        .catch(() => {});
    }
    return;
  }
  if (event === 'TOGGLE_SIDEBAR_SYNC' || event === 'SET_SIDEBAR_SYNC_WINDOW') {
    if (payload?.enabled === false) {
      ack?.({ success: true, active: false, remaining_seconds: 0 });
      return;
    }
    syncFromDesktopToMobile(nativeFetch)
      .then((res) => {
        ack?.({ success: true, active: true, remaining_seconds: 120, ...res });
      })
      .catch((err) => {
        for (const src of store.inboxSources) {
          if (src.source_type === 'page_messenger' && src.status === 'ACTIVE' && src.token) {
            syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 30, msgLimit: 30, broadcastRealtime: true }).catch(() => {});
          }
        }
        broadcastMobileSocket('DESKTOP_SYNC_ERROR', { error: err.message });
        ack?.({ success: false, error: err.message });
      });
  }
}

// Fast priority poller (2.5s) for open conversation + batched background poller (8s) for all Fanpages
let pollerStarted = false;
let activePollerBusy = false;
let bgPollerBusy = false;

export function startMobilePagePoller(nativeFetch) {
  if (pollerStarted) return;
  pollerStarted = true;

  const pollActiveOpenThreadPage = async () => {
    if (activePollerBusy || !activeOpenThreadId) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const user = getSavedUser();
    if (!user) return;
    const openThread = store.threads.find((t) => String(t.id) === String(activeOpenThreadId));
    if (!openThread || openThread.source_type !== 'page_messenger') return;
    const src = store.inboxSources.find((s) => String(s.id) === String(openThread.source_id))
      || store.inboxSources.find((s) => s.source_type === 'page_messenger' && String(s.external_id) === String(openThread.source_external_id || '') && s.token);
    if (!src || src.status !== 'ACTIVE' || !src.token) return;

    activePollerBusy = true;
    try {
      await syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 12, msgLimit: 25, broadcastRealtime: true });
    } catch (_) {
    } finally {
      activePollerBusy = false;
    }
  };

  const pollAllPagesBackground = async () => {
    if (bgPollerBusy) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const user = getSavedUser();
    if (!user) return;
    const activeSources = store.inboxSources.filter(
      (s) => s.source_type === 'page_messenger' && s.status === 'ACTIVE' && s.token
    );
    if (!activeSources.length) return;

    bgPollerBusy = true;
    try {
      const BATCH_SIZE = 4;
      for (let i = 0; i < activeSources.length; i += BATCH_SIZE) {
        const batch = activeSources.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((src) =>
            syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 15, msgLimit: 15, broadcastRealtime: true })
          )
        );
      }
    } catch (_) {
    } finally {
      bgPollerBusy = false;
    }
  };

  setInterval(pollActiveOpenThreadPage, 2500);
  setInterval(pollAllPagesBackground, 8000);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        store = normalizeLoadedStore(store);
        pollActiveOpenThreadPage();
        pollAllPagesBackground();
      }
    });
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function parseRequestBody(input, init) {
  try {
    if (typeof init?.body === 'string') return JSON.parse(init.body);
    if (init?.body instanceof FormData) return init.body;
    if (input instanceof Request) {
      const cloned = input.clone();
      return await cloned.json();
    }
  } catch (_) {}
  return {};
}

// ── Main Standalone API Router for `/api/*` on Mobile ──
export async function handleMobileStandaloneApi(nativeFetch, urlStr, input, init = {}) {
  startMobilePagePoller(nativeFetch);
  const parsedUrl = new URL(urlStr, 'https://localhost');
  const pathname = parsedUrl.pathname;
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const machineId = getMachineId();

  // 1. Health & Update Status
  if (pathname === '/api/health') {
    return jsonResponse({ status: 'OK', runtime_version: '1.0.40', mode: 'mobile_standalone' });
  }
  if (pathname.startsWith('/api/app-update')) {
    return jsonResponse({
      success: true,
      currentVersion: '1.0.40',
      latestVersion: '1.0.40',
      updateAvailable: false,
      state: 'idle'
    });
  }

  // 2. Authentication -> Directly via Central License Server (genblackmmoonline.online/license_server)
  if (pathname === '/api/auth/latest-local-session') {
    const saved = getSavedUser();
    if (saved) return jsonResponse({ success: true, user: saved });
    return jsonResponse({ success: false }, 404);
  }
  if (pathname === '/api/auth/me') {
    const saved = getSavedUser();
    if (!saved) return jsonResponse({ success: false, code: 'AUTH_REQUIRED' }, 401);
    try {
      const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/account-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: saved.username, machineId })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 403 || resp.status === 404) {
        setSavedUser(null);
        return jsonResponse({ success: false, code: data.code || 'AUTH_INVALID', message: data.message }, 401);
      }
      if (data?.data) {
        const merged = { ...saved, ...data.data };
        setSavedUser(merged);
        return jsonResponse({ success: true, user: merged });
      }
    } catch (_) {}
    return jsonResponse({ success: true, user: saved });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    try {
      const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(body.username || '').trim().toLowerCase(),
          password: String(body.password || ''),
          machineId
        })
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || !result.success) {
        return jsonResponse({
          success: false,
          code: result.code || 'LOGIN_FAILED',
          message: result.message || 'Tên đăng nhập hoặc mật khẩu không đúng.'
        }, resp.status || 400);
      }
      const user = result.data;
      setSavedUser(user);
      return jsonResponse({ success: true, user });
    } catch (err) {
      return jsonResponse({
        success: false,
        message: 'Không thể kết nối máy chủ xác thực (' + (err?.message || 'Lỗi mạng') + ')'
      }, 503);
    }
  }
  if (pathname === '/api/auth/register-otp' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/register-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email, machineId })
    });
    const result = await resp.json().catch(() => ({}));
    return jsonResponse(result, resp.status);
  }
  if (pathname === '/api/auth/reset-password-otp' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/reset-password-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email, machineId })
    });
    const result = await resp.json().catch(() => ({}));
    return jsonResponse(result, resp.status);
  }
  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, machineId })
    });
    const result = await resp.json().catch(() => ({}));
    return jsonResponse(result, resp.status);
  }
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, machineId })
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || !result.success) {
      return jsonResponse({
        success: false,
        message: result.message || 'Không thể đăng ký tài khoản.'
      }, resp.status || 400);
    }
    const user = result.data;
    setSavedUser(user);
    return jsonResponse({ success: true, user }, 201);
  }
  if (pathname === '/api/auth/google' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: body.credential, machineId })
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || !result.success) {
      return jsonResponse({
        success: false,
        message: result.message || 'Không thể đăng nhập bằng Google.'
      }, resp.status || 400);
    }
    const user = result.data;
    setSavedUser(user);
    return jsonResponse({ success: true, user });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    setSavedUser(null);
    return jsonResponse({ success: true });
  }

  // 3. License Status, Activation & Deactivation -> Central License Server
  if (pathname === '/api/license/status') {
    const user = getSavedUser();
    if (!user) return jsonResponse({ success: false, code: 'AUTH_REQUIRED' }, 401);
    const savedKey = getStoredLicenseKey() || '';
    try {
      const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/license-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, key: '', machineId })
      });
      const result = await resp.json().catch(() => ({}));
      if (result.success && result.data?.valid) {
        if (result.data.key) setStoredLicenseKey(result.data.key);
        if (store.threads.length === 0) {
          syncFromDesktopToMobile(nativeFetch).catch(() => {});
        }
        return jsonResponse({
          success: true,
          data: { isLicensed: true, ...result.data }
        });
      }
      if (savedKey) {
        const vResp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/license/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: savedKey, machineId })
        });
        const vData = await vResp.json().catch(() => ({}));
        if (vData?.valid) {
          return jsonResponse({
            success: true,
            data: {
              isLicensed: true,
              key: savedKey,
              expiresAt: vData.expiresAt,
              daysRemaining: vData.daysRemaining,
              machines: vData.machines
            }
          });
        }
      }
      return jsonResponse({
        success: true,
        data: {
          isLicensed: false,
          reason: result.data?.reason || 'NO_KEY',
          message: result.data?.message || 'Tài khoản chưa kích hoạt gói License Key.'
        }
      });
    } catch (_) {
      return jsonResponse({
        success: true,
        data: { isLicensed: false, reason: 'SERVER_OFFLINE', message: 'Không thể kết nối máy chủ bản quyền.' }
      });
    }
  }
  if (pathname === '/api/license/activate' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const user = getSavedUser();
    const key = String(body.key || '').trim();
    if (!key) return jsonResponse({ success: false, message: 'Thiếu mã Key' }, 400);
    const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        machineId,
        deviceName: 'EasyChat Mobile Android',
        clientUsername: user?.username || null
      })
    });
    const result = await resp.json().catch(() => ({}));
    if (resp.ok && result.success) {
      setStoredLicenseKey(key);
      return jsonResponse({
        success: true,
        message: result.message || 'Kích hoạt bản quyền thành công!',
        data: { isLicensed: true, key, ...result.data }
      });
    }
    return jsonResponse({
      success: false,
      message: result.message || result.error || 'Kích hoạt Key thất bại.'
    }, 400);
  }
  if (pathname === '/api/license/deactivate' && method === 'POST') {
    const savedKey = getStoredLicenseKey();
    if (savedKey) {
      await nativeFetch(`${LICENSE_SERVER_BASE}/api/license/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: savedKey, machineId })
      }).catch(() => {});
    }
    setStoredLicenseKey('');
    return jsonResponse({ success: true });
  }

  // 4. Desktop -> Mobile Sync API & Accounts & Inbox Sources
  if ((pathname === '/api/mobile-sync/from-desktop' || pathname === '/api/desktop-sync/push-now') && method === 'POST') {
    try {
      const res = await syncFromDesktopToMobile(nativeFetch);
      return jsonResponse(res);
    } catch (err) {
      return jsonResponse({ success: false, message: err.message }, 400);
    }
  }
  if (pathname === '/api/accounts' && method === 'GET') {
    if (Array.isArray(store.accounts) && store.accounts.length > 0) {
      return jsonResponse(store.accounts);
    }
    return jsonResponse([
      {
        id: 'page_workspace',
        name: 'Kho Fanpage EasyChat',
        status: 'ACTIVE',
        is_extension_connected: true,
        is_chrome_running: false,
        chrome_display_mode: 'BACKGROUND'
      }
    ]);
  }
  if (pathname === '/api/inbox-sources' && method === 'GET') {
    return jsonResponse(store.inboxSources);
  }
  if (pathname === '/api/inbox-sources/page' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const token = String(body.page_access_token || '').trim();
    if (!token) return jsonResponse({ error: 'Thiếu Page Access Token' }, 400);
    try {
      const me = await graphFetch(nativeFetch, 'me', { fields: 'id,name,picture{url}', access_token: token });
      const src = upsertMobilePageSource({
        pageId: String(me.id),
        name: me.name || `Page ${me.id}`,
        avatarUrl: me.picture?.data?.url || `https://graph.facebook.com/${me.id}/picture?type=normal`,
        token
      });
      syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 30, msgLimit: 40, broadcastRealtime: true }).catch(() => {});
      return jsonResponse({ success: true, source: src });
    } catch (err) {
      return jsonResponse({ error: err.message }, 400);
    }
  }
  if (pathname.startsWith('/api/inbox-sources/') && method === 'DELETE') {
    const sourceId = decodeURIComponent(pathname.slice('/api/inbox-sources/'.length));
    store.inboxSources = store.inboxSources.map((s) => (String(s.id) === sourceId ? { ...s, status: 'DISCONNECTED' } : s));
    saveStore();
    return jsonResponse({ success: true });
  }

  // 5. Page API Routes (/api/page-api/*)
  if (pathname === '/api/page-api/config') {
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      store.pageBridgeConfig = {
        ...store.pageBridgeConfig,
        bridge_url: String(body.bridge_url || '').trim() || store.pageBridgeConfig.bridge_url
      };
      saveStore();
    }
    return jsonResponse({
      success: true,
      bridge_url: store.pageBridgeConfig.bridge_url,
      verify_token: store.pageBridgeConfig.verify_token,
      webhook_url: store.pageBridgeConfig.bridge_url
    });
  }
  if (/^\/api\/page-api\/accounts\/[^/]+\/pages$/.test(pathname) && method === 'GET') {
    const pages = store.inboxSources
      .filter((s) => s.source_type === 'page_messenger')
      .map((s) => ({
        page_id: String(s.external_id),
        name: s.display_name,
        avatar_url: s.avatar_url || `https://graph.facebook.com/${s.external_id}/picture?type=normal`,
        category: 'Trang Facebook',
        has_token: Boolean(s.token),
        token: s.token || '',
        is_connected: s.status === 'ACTIVE',
        connected_at: s.created_at
      }));
    return jsonResponse({
      success: true,
      account_id: 'page_workspace',
      pages,
      app: null,
      apps: []
    });
  }
  if (pathname === '/api/page-api/import-tokens' && method === 'POST') {
    const body = await parseRequestBody(input, init);
    const raw = Array.isArray(body?.tokens) ? body.tokens.join('\n') : String(body?.tokens || '');
    const tokens = [...new Set(raw.split(/[\s,;]+/).map((t) => t.trim()).filter((t) => t.length >= 20))];
    if (!tokens.length) {
      return jsonResponse({ success: false, error: 'Chưa có token hợp lệ nào (token dài hơn 20 ký tự)' }, 400);
    }
    const mask = (t) => `${String(t).slice(0, 8)}…${String(t).slice(-6)}`;
    const results = [];

    for (const token of tokens) {
      try {
        const me = await graphFetch(nativeFetch, 'me', {
          fields: 'id,name,picture{url}',
          metadata: '1',
          metadata_fields: 'type',
          access_token: token
        });
        const tokenType = String(me?.metadata?.type || 'Page');
        if (tokenType === 'User') {
          const accounts = await graphFetch(nativeFetch, 'me/accounts', {
            fields: 'id,name,access_token,picture{url}',
            limit: 100,
            access_token: token
          });
          const list = Array.isArray(accounts?.data) ? accounts.data : [];
          if (!list.length) {
            results.push({ token: mask(token), type: 'User', status: 'error', error: 'User này không quản lý Fanpage nào' });
            continue;
          }
          for (const p of list) {
            const src = upsertMobilePageSource({
              pageId: String(p.id),
              name: p.name || 'Facebook Page',
              avatarUrl: p.picture?.data?.url || `https://graph.facebook.com/${p.id}/picture?type=normal`,
              token: p.access_token
            });
            syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 35, msgLimit: 40, broadcastRealtime: true }).catch(() => {});
          }
          results.push({ token: mask(token), type: 'User', status: 'imported', pages: list.map((p) => p.name) });
        } else {
          const src = upsertMobilePageSource({
            pageId: String(me.id),
            name: me.name || 'Facebook Page',
            avatarUrl: me.picture?.data?.url || `https://graph.facebook.com/${me.id}/picture?type=normal`,
            token
          });
          syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 35, msgLimit: 40, broadcastRealtime: true }).catch(() => {});
          results.push({ token: mask(token), type: 'Page', status: 'imported', page_id: String(me.id), pageName: me.name || '' });
        }
      } catch (err) {
        results.push({ token: mask(token), status: 'error', error: err.message });
      }
    }
    return jsonResponse({
      success: true,
      results,
      note: 'Đã nhận diện Fanpage và đang đồng bộ toàn bộ hội thoại về máy!'
    });
  }
  if (/^\/api\/page-api\/accounts\/[^/]+\/backfill$/.test(pathname) && method === 'POST') {
    const activeSources = store.inboxSources.filter((s) => s.source_type === 'page_messenger' && s.status === 'ACTIVE' && s.token);
    if (!activeSources.length) {
      return jsonResponse({ success: false, error: 'Chưa có Fanpage nào có Page Access Token. Hãy dán Token ở ô bên trên trước.' });
    }
    const results = [];
    for (const src of activeSources) {
      try {
        const r = await syncPageConversationsOnMobile(nativeFetch, src, { convLimit: 40, msgLimit: 50, broadcastRealtime: true });
        results.push({ page_id: src.external_id, name: src.display_name, ok: true, ...r });
      } catch (err) {
        results.push({ page_id: src.external_id, name: src.display_name, ok: false, error: err.message });
      }
    }
    return jsonResponse({ success: true, results });
  }
  if (pathname === '/api/page-api/sync-status') {
    return jsonResponse({ success: true, active: false, job: null });
  }

  // 6. Threads & Messages
  if (pathname === '/api/threads' && method === 'GET') {
    const sorted = store.threads
      .filter((t) => !t.archived_at)
      .slice()
      .sort((a, b) => (Number(b.is_pinned) - Number(a.is_pinned)) || ((Number(b.last_msg_ts) || 0) - (Number(a.last_msg_ts) || 0)));
    return jsonResponse(sorted);
  }
  if (pathname === '/api/threads/waiting-count') {
    return jsonResponse({ count: 0 });
  }
  if (pathname === '/api/threads/active-on') {
    return jsonResponse({ success: true, thread_ids: store.threads.map((t) => t.id) });
  }
  const threadMessagesMatch = pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (threadMessagesMatch) {
    const tid = decodeURIComponent(threadMessagesMatch[1]);
    if (method === 'GET') {
      activeOpenThreadId = tid;
      const list = store.messagesByThread[tid] || [];
      return jsonResponse(list);
    }
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      try {
        const sent = await sendPageMessageOnMobile(nativeFetch, {
          threadId: tid,
          content: body.content || body.text,
          attachmentIds: body.attachment_ids || [],
          clientMessageId: body.client_message_id
        });
        return jsonResponse({ success: true, messages: sent });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 400);
      }
    }
  }
  const threadReadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/(?:read|mark-read)$/);
  if (threadReadMatch && method === 'POST') {
    const tid = decodeURIComponent(threadReadMatch[1]);
    store.threads = store.threads.map((t) => (String(t.id) === tid ? { ...t, is_unread: 0 } : t));
    saveStore();
    return jsonResponse({ success: true });
  }
  const threadUnreadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/unread$/);
  if (threadUnreadMatch && method === 'POST') {
    const tid = decodeURIComponent(threadUnreadMatch[1]);
    const body = await parseRequestBody(input, init);
    const nextUnread = (body.unread ?? body.is_unread) ? 1 : 0;
    store.threads = store.threads.map((t) => (String(t.id) === tid ? { ...t, is_unread: nextUnread } : t));
    saveStore();
    return jsonResponse({ success: true });
  }
  const threadPinMatch = pathname.match(/^\/api\/threads\/([^/]+)\/pin$/);
  if (threadPinMatch && method === 'POST') {
    const tid = decodeURIComponent(threadPinMatch[1]);
    const body = await parseRequestBody(input, init);
    const nextPinned = (body.pinned ?? body.is_pinned) ? 1 : 0;
    store.threads = store.threads.map((t) => (
      String(t.id) === tid ? { ...t, pinned: nextPinned, is_pinned: nextPinned } : t
    ));
    saveStore();
    return jsonResponse({ success: true });
  }
  const threadCapabilitiesMatch = pathname.match(/^\/api\/threads\/([^/]+)\/rich-message-capabilities$/);
  if (threadCapabilitiesMatch) {
    return jsonResponse({
      success: true,
      capabilities: {
        text: { enabled: true },
        image: { enabled: true, max_bytes: 25 * 1024 * 1024 },
        video: { enabled: true, max_bytes: 25 * 1024 * 1024 },
        file: { enabled: true, max_bytes: 25 * 1024 * 1024 }
      }
    });
  }
  const threadMembersMatch = pathname.match(/^\/api\/threads\/([^/]+)\/members$/);
  if (threadMembersMatch) {
    return jsonResponse({ success: true, members: [] });
  }
  const threadReminderMatch = pathname.match(/^\/api\/threads\/([^/]+)\/reminder$/);
  if (threadReminderMatch) {
    const tid = decodeURIComponent(threadReminderMatch[1]);
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      store.threads = store.threads.map((t) => (String(t.id) === tid ? { ...t, reminder_due_at: body.due_at, reminder_note: body.note || '' } : t));
      saveStore();
      return jsonResponse({ success: true });
    }
    if (method === 'DELETE') {
      store.threads = store.threads.map((t) => (String(t.id) === tid ? { ...t, reminder_due_at: null, reminder_note: null } : t));
      saveStore();
      return jsonResponse({ success: true });
    }
  }
  const threadArchiveMatch = pathname.match(/^\/api\/threads\/([^/]+)\/archive$/);
  if (threadArchiveMatch && method === 'POST') {
    const tid = decodeURIComponent(threadArchiveMatch[1]);
    const body = await parseRequestBody(input, init);
    const archivedAt = body.archived === false ? null : new Date().toISOString();
    store.threads = store.threads.map((t) => (String(t.id) === tid ? { ...t, archived_at: archivedAt } : t));
    saveStore();
    return jsonResponse({ success: true, archived_at: archivedAt });
  }

  // 7. Outbound Messages & Attachments
  if ((pathname === '/api/messages/send' || pathname === '/api/rich-messages/send') && method === 'POST') {
    const body = await parseRequestBody(input, init);
    try {
      const sent = await sendPageMessageOnMobile(nativeFetch, {
        threadId: body.thread_id || body.threadId,
        content: body.content || body.text,
        attachmentIds: body.attachment_ids || (body.attachment_id ? [body.attachment_id] : []),
        clientMessageId: body.client_message_id || body.clientMessageId
      });
      return jsonResponse({ success: true, messages: sent, message: sent[sent.length - 1] || null });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message, message: err.message }, 400);
    }
  }
  if ((pathname === '/api/attachments/stage' || pathname === '/api/rich-messages/attachments') && method === 'POST') {
    const form = await parseRequestBody(input, init);
    const file = form instanceof FormData ? (form.get('file') || form.get('attachment')) : null;
    if (!file) return jsonResponse({ success: false, error: 'Không tìm thấy tệp đính kèm' }, 400);
    const id = 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const mime = String(file.type || '');
    const mediaType = mime.startsWith('video/') ? 'video' : (mime.startsWith('image/') ? 'image' : 'file');
    const previewUrl = URL.createObjectURL(file);
    const record = {
      id,
      attachment_id: id,
      file,
      preview_url: previewUrl,
      media_url: previewUrl,
      media_type: mediaType,
      name: file.name || 'attachment',
      size: file.size || 0,
      mime_type: mime
    };
    stagedFiles.set(id, record);
    return jsonResponse({ success: true, attachment: record, data: record });
  }

  // 8. Contacts & Lead Statuses
  if (pathname === '/api/contacts' && method === 'GET') {
    return jsonResponse(Object.values(store.contactsByThread));
  }
  const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch) {
    const tid = decodeURIComponent(contactMatch[1]);
    if (method === 'GET') {
      activeOpenThreadId = tid;
      const existingContact = store.contactsByThread[tid] || { thread_id: tid };
      const cleanedAvatar = sanitizeMobileAvatarUrl(existingContact.avatar_url);
      const thread = store.threads.find((t) => String(t.id) === tid);
      if (!cleanedAvatar && thread && thread.source_type === 'page_messenger') {
        const src = store.inboxSources.find((s) => String(s.id) === String(thread.source_id))
          || store.inboxSources.find((s) => s.source_type === 'page_messenger' && String(s.external_id) === String(thread.source_external_id || '') && s.token);
        const psid = String(thread.external_thread_id || String(tid).split(':').pop());
        if (src && psid) {
          enrichCustomerProfileOnMobile(nativeFetch, src, tid, psid).catch(() => {});
        }
      }
      return jsonResponse({ ...existingContact, avatar_url: cleanedAvatar });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await parseRequestBody(input, init);
      const next = { ...(store.contactsByThread[tid] || { thread_id: tid }), ...body, thread_id: tid };
      store.contactsByThread[tid] = next;
      store.threads = store.threads.map((t) => (String(t.id) === tid ? {
        ...t,
        nickname: next.nickname ?? t.nickname,
        phone: next.phone ?? t.phone,
        is_vip: next.is_vip ?? t.is_vip,
        lead_status_id: next.lead_status_id ?? t.lead_status_id
      } : t));
      saveStore();
      return jsonResponse({ success: true, contact: next });
    }
  }
  if (pathname === '/api/lead-statuses') {
    if (method === 'GET') return jsonResponse(store.leadStatuses);
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      const created = {
        id: Date.now(),
        name: String(body.name || 'Trạng thái mới').trim(),
        color: body.color || '#0ea5e9',
        sort_order: store.leadStatuses.length + 1
      };
      store.leadStatuses.push(created);
      saveStore();
      return jsonResponse({ success: true, status: created, data: created });
    }
  }
  const leadStatusDelMatch = pathname.match(/^\/api\/lead-statuses\/([^/]+)$/);
  if (leadStatusDelMatch && method === 'DELETE') {
    const id = Number(leadStatusDelMatch[1]);
    store.leadStatuses = store.leadStatuses.filter((s) => Number(s.id) !== id);
    saveStore();
    return jsonResponse({ success: true });
  }

  // 9. Quick Templates & Auto-Reply
  if (pathname === '/api/quick-templates') {
    if (method === 'GET') return jsonResponse(store.quickTemplates);
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      const item = { id: Date.now(), shortcut: body.shortcut || '', content: body.content || '', title: body.title || '' };
      store.quickTemplates.push(item);
      saveStore();
      return jsonResponse({ success: true, template: item, data: item });
    }
  }
  if (pathname === '/api/auto-reply' || pathname === '/api/auto-reply/rules') {
    if (method === 'GET') return jsonResponse(store.autoReplyRules);
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      const rule = { id: Date.now(), ...body, is_active: 1 };
      store.autoReplyRules.push(rule);
      saveStore();
      return jsonResponse({ success: true, rule });
    }
  }

  // 10. Comment Leads (Fanpage Post Comments via Graph API)
  if (pathname.startsWith('/api/comment-leads')) {
    if (pathname === '/api/comment-leads/posts' && method === 'GET') {
      const posts = [];
      for (const src of store.inboxSources.filter((s) => s.source_type === 'page_messenger' && s.status === 'ACTIVE' && s.token)) {
        try {
          const data = await graphFetch(nativeFetch, `${src.external_id}/posts`, {
            fields: 'id,message,created_time,permalink_url,comments.limit(30){id,message,created_time,from}',
            limit: 10,
            access_token: src.token
          });
          for (const p of (data?.data || [])) {
            posts.push({ ...p, page_id: src.external_id, page_name: src.display_name });
          }
        } catch (_) {}
      }
      return jsonResponse({ success: true, posts, items: posts });
    }
    return jsonResponse({ success: true, items: [], posts: [] });
  }

  // 11. Campaigns, AI Config, Phone Automation, Employees, Search
  if (pathname === '/api/campaigns/config' && method === 'GET') {
    return jsonResponse({
      enabled: true,
      max_recipients: 500,
      min_pacing_ms: 500,
      default_pacing_ms: 2000,
      max_retries: 3
    });
  }
  if (pathname === '/api/campaigns') {
    if (method === 'GET') {
      const limit = Number(parsedUrl.searchParams.get('limit') || 50);
      const list = store.campaigns.map((c) => recomputeMobileCampaignCounts(c)).slice(0, limit);
      return jsonResponse(list);
    }
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      const nowIso = new Date().toISOString();
      const rawMessages = Array.isArray(body.messages) && body.messages.length
        ? body.messages
        : [{ text_content: body.message_template || body.content || '' }];
      const messages = rawMessages.map((m, idx) => ({
        id: `cmsg_${Date.now()}_${idx}`,
        position: idx + 1,
        text_content: String(m?.text_content ?? m?.content ?? '').trim(),
        attachments: []
      }));
      const threadIds = Array.isArray(body.thread_ids) ? body.thread_ids : [];
      const recipients = threadIds.map((tid, idx) => {
        const thread = store.threads.find((t) => String(t.id) === String(tid));
        const sourceType = thread?.source_type || 'page_messenger';
        const isPage = sourceType === 'page_messenger';
        return {
          id: `crec_${Date.now()}_${idx}`,
          position: idx + 1,
          thread_id: String(tid),
          contact_name: thread?.nickname || thread?.contact_name || thread?.name || String(tid),
          source_type: sourceType,
          source_id: thread?.source_id || null,
          source_name: thread?.source_name || '',
          account_id: thread?.account_id || null,
          eligible: isPage,
          status: isPage ? 'pending' : 'skipped',
          error_message: isPage ? null : 'Mobile hiện chỉ hỗ trợ gửi chiến dịch qua Fanpage.',
          attempts: 0,
          sent_at: null
        };
      });
      const camp = recomputeMobileCampaignCounts({
        id: 'camp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: String(body.name || 'Chiến dịch Fanpage').trim(),
        status: 'ready',
        messages,
        recipients,
        start_position: Math.max(1, Number(body.start_position || 1)),
        direction: body.direction === 'backward' ? 'backward' : 'forward',
        pacing_ms: Math.max(500, Number(body.pacing_ms || 2000)),
        max_retries: Math.max(0, Number(body.max_retries ?? 1)),
        send_cap: Math.max(1, Number(body.send_cap || recipients.length || 1)),
        phone_capture_policy: body.phone_capture_policy || 'continue',
        phone_capture_thank_you_text: body.phone_capture_thank_you_text || null,
        phone_capture_status_id: body.phone_capture_status_id || null,
        audit: [{ id: `aud_${Date.now()}`, action: 'created', message: 'Đã tạo chiến dịch trên Mobile', created_at: nowIso }],
        created_at: nowIso,
        updated_at: nowIso
      });
      store.campaigns.unshift(camp);
      saveStore();
      return jsonResponse(camp, 201);
    }
  }
  const campaignAttachmentDeleteMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/attachments\/([^/]+)$/);
  if (campaignAttachmentDeleteMatch && method === 'DELETE') {
    const campId = decodeURIComponent(campaignAttachmentDeleteMatch[1]);
    const attId = decodeURIComponent(campaignAttachmentDeleteMatch[2]);
    const camp = store.campaigns.find((c) => String(c.id) === campId);
    if (!camp) return jsonResponse({ error: { message: 'Không tìm thấy campaign.' } }, 404);
    for (const m of (camp.messages || [])) {
      m.attachments = (m.attachments || []).filter((a) => String(a.id) !== attId);
    }
    stagedFiles.delete(attId);
    camp.updated_at = new Date().toISOString();
    saveStore();
    return jsonResponse({ success: true, campaign: recomputeMobileCampaignCounts(camp) });
  }
  const campaignAttachmentsMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/attachments$/);
  if (campaignAttachmentsMatch && method === 'POST') {
    const campId = decodeURIComponent(campaignAttachmentsMatch[1]);
    const camp = store.campaigns.find((c) => String(c.id) === campId);
    if (!camp) return jsonResponse({ error: { message: 'Không tìm thấy campaign.' } }, 404);
    const form = await parseRequestBody(input, init);
    const msgId = form instanceof FormData ? String(form.get('campaign_message_id') || '') : '';
    const files = form instanceof FormData
      ? [...form.getAll('files'), ...(form.get('file') ? [form.get('file')] : [])].filter(Boolean)
      : [];
    const targetMsg = (camp.messages || []).find((m) => String(m.id) === msgId) || camp.messages?.[0];
    if (!targetMsg || !files.length) {
      return jsonResponse({ error: { message: 'Không tìm thấy tệp đính kèm hợp lệ.' } }, 400);
    }
    if (!Array.isArray(targetMsg.attachments)) targetMsg.attachments = [];
    for (const file of files) {
      const id = 'catt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const mime = String(file.type || '');
      const mediaType = mime.startsWith('video/') ? 'video' : (mime.startsWith('image/') ? 'image' : 'file');
      const previewUrl = URL.createObjectURL(file);
      stagedFiles.set(id, {
        id,
        attachment_id: id,
        file,
        preview_url: previewUrl,
        media_url: previewUrl,
        media_type: mediaType,
        name: file.name || 'attachment',
        size: file.size || 0,
        mime_type: mime
      });
      targetMsg.attachments.push({
        id,
        original_name: file.name || 'attachment',
        safe_name: file.name || 'attachment',
        media_type: mediaType,
        mime_type: mime,
        byte_size: file.size || 0,
        preview_url: previewUrl,
        url: previewUrl
      });
    }
    camp.updated_at = new Date().toISOString();
    saveStore();
    return jsonResponse({ success: true, campaign: recomputeMobileCampaignCounts(camp) });
  }
  const campaignRetryRecipientMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/recipients\/([^/]+)\/retry$/);
  if (campaignRetryRecipientMatch && method === 'POST') {
    const campId = decodeURIComponent(campaignRetryRecipientMatch[1]);
    const recId = decodeURIComponent(campaignRetryRecipientMatch[2]);
    const camp = store.campaigns.find((c) => String(c.id) === campId);
    if (!camp) return jsonResponse({ error: { message: 'Không tìm thấy campaign.' } }, 404);
    const rec = (camp.recipients || []).find((r) => String(r.id) === recId);
    if (!rec) return jsonResponse({ error: { message: 'Không tìm thấy người nhận.' } }, 404);
    await sendMobileCampaignToRecipient(nativeFetch, camp, rec);
    recomputeMobileCampaignCounts(camp);
    saveStore();
    broadcastMobileSocket('CAMPAIGN_UPDATED', { campaign_id: camp.id });
    return jsonResponse(camp);
  }
  const campaignResponseStatsMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/response-stats$/);
  if (campaignResponseStatsMatch && method === 'GET') {
    const campId = decodeURIComponent(campaignResponseStatsMatch[1]);
    const camp = store.campaigns.find((c) => String(c.id) === campId);
    if (!camp) return jsonResponse({ error: { message: 'Không tìm thấy campaign.' } }, 404);
    const sentRecipients = (camp.recipients || []).filter((r) => r.status === 'sent');
    const items = sentRecipients.map((r) => {
      const sentMs = Date.parse(r.sent_at || '') || 0;
      const threadMsgs = store.messagesByThread[r.thread_id] || [];
      const customerReplies = threadMsgs.filter((m) => !m.is_outgoing && (Number(m.timestamp_ms) || Date.parse(m.created_at || '') || 0) > sentMs);
      const firstReply = customerReplies[0] || null;
      const contact = store.contactsByThread[r.thread_id] || {};
      const phone = contact.phone || customerReplies.map((m) => extractPhoneFromText(m.content)).find(Boolean) || null;
      return {
        recipient_id: r.id,
        thread_id: r.thread_id,
        contact_name: r.contact_name,
        source_name: r.source_name,
        sent_at: r.sent_at,
        replied: customerReplies.length > 0,
        reply_count: customerReplies.length,
        reply_preview: firstReply ? (firstReply.content || (firstReply.media_type === 'video' ? '[Video]' : '[Ảnh]')) : null,
        replied_at: firstReply?.created_at || null,
        last_reply_at: customerReplies.length ? customerReplies[customerReplies.length - 1].created_at : null,
        last_reply_text: customerReplies.length ? customerReplies[customerReplies.length - 1].content : null,
        has_phone: Boolean(phone),
        phone,
        phone_captured_at: contact.phone_captured_at || (phone ? firstReply?.created_at || null : null)
      };
    });
    const replied = items.filter((i) => i.replied);
    const withPhone = items.filter((i) => i.has_phone);
    const unanswered = items.filter((i) => !i.replied);
    const sentCount = sentRecipients.length;
    const replyRate = sentCount > 0 ? Math.round((replied.length / sentCount) * 1000) / 10 : 0;
    const phoneRate = sentCount > 0 ? Math.round((withPhone.length / sentCount) * 1000) / 10 : 0;
    return jsonResponse({
      campaign_id: camp.id,
      counts: {
        sent: sentCount,
        replied: replied.length,
        with_phone: withPhone.length,
        phone: withPhone.length,
        unanswered: unanswered.length
      },
      rates: {
        reply_rate: replyRate,
        phone_rate: phoneRate
      },
      recipients: items,
      replied,
      phone: withPhone,
      unanswered
    });
  }
  const campaignActionMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/(preview|start|resume|pause|cancel)$/);
  if (campaignActionMatch && method === 'POST') {
    const campId = decodeURIComponent(campaignActionMatch[1]);
    const action = campaignActionMatch[2];
    const camp = store.campaigns.find((c) => String(c.id) === campId);
    if (!camp) return jsonResponse({ error: { message: 'Không tìm thấy campaign.' } }, 404);
    const nowIso = new Date().toISOString();
    if (!Array.isArray(camp.audit)) camp.audit = [];
    if (action === 'preview') {
      camp.status = 'ready';
      camp.audit.push({ id: `aud_${Date.now()}`, action: 'preview', message: 'Đã kiểm tra hợp lệ — sẵn sàng gửi', created_at: nowIso });
    } else if (action === 'pause') {
      camp.status = 'paused';
      camp.audit.push({ id: `aud_${Date.now()}`, action: 'pause', message: 'Đã tạm dừng chiến dịch', created_at: nowIso });
    } else if (action === 'cancel') {
      camp.status = 'cancelled';
      for (const r of (camp.recipients || [])) {
        if (r.status === 'pending' || r.status === 'processing') r.status = 'cancelled';
      }
      camp.audit.push({ id: `aud_${Date.now()}`, action: 'cancel', message: 'Đã hủy chiến dịch', created_at: nowIso });
    } else if (action === 'start' || action === 'resume') {
      camp.status = 'running';
      camp.audit.push({ id: `aud_${Date.now()}`, action, message: action === 'start' ? 'Bắt đầu chạy chiến dịch' : 'Tiếp tục chạy chiến dịch', created_at: nowIso });
      runMobileCampaignLoop(nativeFetch, camp).catch(() => {});
    }
    camp.updated_at = nowIso;
    recomputeMobileCampaignCounts(camp);
    saveStore();
    broadcastMobileSocket('CAMPAIGN_UPDATED', { campaign_id: camp.id });
    return jsonResponse(camp);
  }
  const campaignByIdMatch = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (campaignByIdMatch) {
    const campId = decodeURIComponent(campaignByIdMatch[1]);
    const camp = store.campaigns.find((c) => String(c.id) === campId);
    if (!camp) return jsonResponse({ error: { message: 'Không tìm thấy campaign.' } }, 404);
    if (method === 'GET') {
      return jsonResponse(recomputeMobileCampaignCounts(camp));
    }
    if (method === 'PATCH' || method === 'PUT') {
      const body = await parseRequestBody(input, init);
      if (Array.isArray(body.messages)) {
        camp.messages = body.messages.map((m, idx) => ({
          id: camp.messages?.[idx]?.id || `cmsg_${Date.now()}_${idx}`,
          position: idx + 1,
          text_content: String(m?.text_content ?? m?.content ?? '').trim(),
          attachments: camp.messages?.[idx]?.attachments || []
        }));
      }
      if (body.start_position != null) camp.start_position = Math.max(1, Number(body.start_position));
      if (body.direction) camp.direction = body.direction === 'backward' ? 'backward' : 'forward';
      if (body.pacing_ms != null) camp.pacing_ms = Math.max(500, Number(body.pacing_ms));
      if (body.max_retries != null) camp.max_retries = Math.max(0, Number(body.max_retries));
      if (body.send_cap != null) camp.send_cap = Math.max(1, Number(body.send_cap));
      if (body.phone_capture_policy) camp.phone_capture_policy = body.phone_capture_policy;
      if (body.phone_capture_thank_you_text !== undefined) camp.phone_capture_thank_you_text = body.phone_capture_thank_you_text;
      if (body.phone_capture_status_id !== undefined) camp.phone_capture_status_id = body.phone_capture_status_id;
      camp.updated_at = new Date().toISOString();
      recomputeMobileCampaignCounts(camp);
      saveStore();
      return jsonResponse(camp);
    }
  }
  if (pathname === '/api/ai-config') {
    if (method === 'POST' || method === 'PUT') {
      const body = await parseRequestBody(input, init);
      store.aiConfig = { ...store.aiConfig, ...body };
      saveStore();
    }
    return jsonResponse({ success: true, config: store.aiConfig, ...store.aiConfig });
  }
  if (pathname.startsWith('/api/phone-automation')) {
    if (method === 'POST' || method === 'PUT') {
      const body = await parseRequestBody(input, init);
      store.phoneAutomation = { ...store.phoneAutomation, ...body };
      saveStore();
    }
    return jsonResponse({ success: true, settings: store.phoneAutomation, ...store.phoneAutomation });
  }
  if (pathname.startsWith('/api/employees')) {
    const user = getSavedUser();
    if (method === 'GET') return jsonResponse({ success: true, employees: store.employees, data: store.employees });
    if (method === 'POST') {
      const body = await parseRequestBody(input, init);
      const resp = await nativeFetch(`${LICENSE_SERVER_BASE}/api/client-auth/company-employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: user?.username, username: body.username, password: body.password })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success && data.data) {
        store.employees.push(data.data);
        saveStore();
      }
      return jsonResponse(data, resp.status);
    }
  }
  if (pathname.startsWith('/api/search')) {
    const q = String(parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
    const matchedThreads = !q
      ? []
      : store.threads.filter((t) => `${t.contact_name || ''} ${t.last_message || ''} ${t.phone || ''}`.toLowerCase().includes(q));
    return jsonResponse({ success: true, threads: matchedThreads, messages: [] });
  }

  return jsonResponse({ success: true });
}

function upsertMobilePageSource({ pageId, name, avatarUrl, token }) {
  const existingIdx = store.inboxSources.findIndex(
    (s) => s.source_type === 'page_messenger' && String(s.external_id) === String(pageId)
  );
  const nextSource = {
    id: `src_page_${pageId}`,
    source_type: 'page_messenger',
    external_id: String(pageId),
    display_name: name || `Page ${pageId}`,
    avatar_url: avatarUrl || `https://graph.facebook.com/${pageId}/picture?type=normal`,
    owner_account_id: 'page_workspace',
    status: 'ACTIVE',
    token: token || (existingIdx >= 0 ? store.inboxSources[existingIdx].token : ''),
    access_token_encrypted: 'mobile_local',
    created_at: existingIdx >= 0 ? store.inboxSources[existingIdx].created_at : new Date().toISOString()
  };
  if (existingIdx >= 0) {
    store.inboxSources[existingIdx] = nextSource;
  } else {
    store.inboxSources.push(nextSource);
  }
  saveStore();
  return nextSource;
}

const runningCampaignIds = new Set();

function recomputeMobileCampaignCounts(camp) {
  const recipients = Array.isArray(camp.recipients) ? camp.recipients : [];
  const counts = {
    total: recipients.length,
    eligible: recipients.filter((r) => r.eligible !== false).length,
    pending: recipients.filter((r) => r.status === 'pending').length,
    processing: recipients.filter((r) => r.status === 'processing').length,
    sent: recipients.filter((r) => r.status === 'sent').length,
    failed: recipients.filter((r) => r.status === 'failed').length,
    skipped: recipients.filter((r) => r.status === 'skipped').length,
    cancelled: recipients.filter((r) => r.status === 'cancelled').length
  };
  const sourceCounts = {
    page_messenger: recipients.filter((r) => r.source_type === 'page_messenger').length,
    personal_messenger: recipients.filter((r) => r.source_type !== 'page_messenger').length
  };
  camp.counts = counts;
  camp.source_counts = sourceCounts;
  return camp;
}

async function sendMobileCampaignToRecipient(nativeFetch, camp, rec) {
  rec.status = 'processing';
  rec.attempts = Number(rec.attempts || 0) + 1;
  rec.error_message = null;
  recomputeMobileCampaignCounts(camp);
  broadcastMobileSocket('CAMPAIGN_UPDATED', { campaign_id: camp.id });

  try {
    const msgs = Array.isArray(camp.messages) ? camp.messages : [];
    for (const m of msgs) {
      const text = String(m?.text_content || m?.content || '').trim();
      const attIds = Array.isArray(m?.attachments) ? m.attachments.map((a) => a.id).filter(Boolean) : [];
      if (!text && !attIds.length) continue;
      await sendPageMessageOnMobile(nativeFetch, {
        threadId: rec.thread_id,
        content: text,
        attachmentIds: attIds,
        clientMessageId: `camp_${camp.id}_${rec.id}_${m.id || Date.now()}`
      });
    }
    rec.status = 'sent';
    rec.sent_at = new Date().toISOString();
    rec.error_message = null;
  } catch (err) {
    rec.status = 'failed';
    rec.error_message = err?.message || 'Gửi tin thất bại';
  }
}

async function runMobileCampaignLoop(nativeFetch, camp) {
  if (!camp || runningCampaignIds.has(camp.id)) return;
  runningCampaignIds.add(camp.id);
  try {
    const allRecs = Array.isArray(camp.recipients) ? camp.recipients.slice() : [];
    const startIdx = Math.max(0, (Number(camp.start_position || 1) - 1));
    let ordered = camp.direction === 'backward'
      ? allRecs.slice(0, startIdx + 1).reverse()
      : allRecs.slice(startIdx);
    const sendCap = Math.max(1, Number(camp.send_cap || ordered.length || 1));
    let sentInRun = 0;

    for (const rec of ordered) {
      if (camp.status !== 'running') break;
      if (rec.status !== 'pending') continue;
      if (sentInRun >= sendCap) break;

      await sendMobileCampaignToRecipient(nativeFetch, camp, rec);
      sentInRun += 1;
      recomputeMobileCampaignCounts(camp);
      saveStore();
      broadcastMobileSocket('CAMPAIGN_UPDATED', { campaign_id: camp.id });

      if (camp.status !== 'running') break;
      const pacingMs = Math.max(500, Number(camp.pacing_ms || 2000));
      await new Promise((resolve) => setTimeout(resolve, pacingMs));
    }

    if (camp.status === 'running') {
      recomputeMobileCampaignCounts(camp);
      camp.status = camp.counts.failed > 0 && camp.counts.sent > 0
        ? 'completed_with_errors'
        : (camp.counts.failed > 0 && camp.counts.sent === 0 ? 'failed' : 'completed');
      camp.updated_at = new Date().toISOString();
      if (!Array.isArray(camp.audit)) camp.audit = [];
      camp.audit.push({
        id: `aud_${Date.now()}`,
        action: camp.status,
        message: `Hoàn tất: đã gửi ${camp.counts.sent}, lỗi ${camp.counts.failed}`,
        created_at: camp.updated_at
      });
      saveStore();
      broadcastMobileSocket('CAMPAIGN_UPDATED', { campaign_id: camp.id });
    }
  } finally {
    runningCampaignIds.delete(camp.id);
  }
}
