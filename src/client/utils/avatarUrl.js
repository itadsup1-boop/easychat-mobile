export function isMobileStandaloneOrigin() {
  if (typeof window === 'undefined') return false;
  try {
    const saved = String(window.localStorage?.getItem('easychat_server_url') || '').trim();
    if (saved && /^https?:\/\//i.test(saved)) return false;
  } catch (_) {}
  const proto = String(window.location?.protocol || '');
  const host = String(window.location?.hostname || '');
  const port = String(window.location?.port || '');
  if (proto === 'capacitor:' || proto === 'file:') return true;
  if ((host === 'localhost' || host === '127.0.0.1') && !port) return true;
  return false;
}

export function isExpiredFbCdnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const match = url.match(/[?&]oe=([0-9a-fA-F]{8})(?:&|$)/);
  if (!match) return false;
  const expMs = parseInt(match[1], 16) * 1000;
  return expMs > 1577836800000 && expMs < Date.now();
}

export function resolveRenderableAvatarUrl(rawUrl, { allowGraphPsidPicture = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    if (isExpiredFbCdnUrl(trimmed)) return null;
    if (
      !allowGraphPsidPicture &&
      /graph\.facebook\.com\/(?:v[\d.]+\/)?\d+\/picture/i.test(trimmed) &&
      trimmed.includes('access_token=')
    ) {
      return null;
    }
    return trimmed;
  }
  if (isMobileStandaloneOrigin()) {
    return null;
  }
  return trimmed.startsWith('/api/') ? trimmed : `/api/avatars/${trimmed}`;
}
