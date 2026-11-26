/**
 * Pure utilities for staging, discarding, and classifying chat outbound
 * attachments in Mobile Standalone Engine.
 */

/**
 * Classifies an uploaded file into CRM media_type values.
 * @param {string} mimeType
 * @param {string} [fileName]
 * @returns {'image' | 'video' | 'voice' | 'file'}
 */
export function classifyMediaType(mimeType, fileName = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';

  const ext = String(fileName || '').toLowerCase().split('.').pop() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'opus'].includes(ext)) return 'voice';
  return 'file';
}

/**
 * Maps CRM media_type to Facebook Graph API attachment.type.
 * @param {string} mediaType
 * @returns {'image' | 'video' | 'audio' | 'file'}
 */
export function toGraphAttachmentType(mediaType) {
  if (mediaType === 'image') return 'image';
  if (mediaType === 'video') return 'video';
  if (mediaType === 'voice' || mediaType === 'audio') return 'audio';
  return 'file';
}

/**
 * Produces a safe display filename without path separators.
 * @param {string} rawName
 * @returns {string}
 */
export function sanitizeAttachmentName(rawName) {
  const base = String(rawName || 'attachment').replace(/[/\\]/g, '_').trim();
  return base || 'attachment';
}

/**
 * Stages an uploaded File/Blob into the provided Map using the exact metadata
 * contract expected by App.jsx / MessageComposer / AttachmentPreview.
 * @param {Map<string, object>} stagedMap
 * @param {{ threadId?: string | null, file: any, createPreviewUrl?: (file: any) => string }} params
 * @returns {object}
 */
export function stageMobileAttachment(stagedMap, { threadId = null, file, createPreviewUrl }) {
  const id = 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const originalName = String(file?.name || 'attachment');
  const safeName = sanitizeAttachmentName(originalName);
  const mimeType = String(file?.type || 'application/octet-stream');
  const byteSize = Number(file?.size || 0);
  const mediaType = classifyMediaType(mimeType, originalName);
  const previewUrl = typeof createPreviewUrl === 'function' ? createPreviewUrl(file) : '';

  const record = {
    id,
    attachment_id: id,
    thread_id: threadId != null ? String(threadId) : null,
    file,
    original_name: originalName,
    safe_name: safeName,
    name: safeName,
    byte_size: byteSize,
    size: byteSize,
    mime_type: mimeType,
    media_type: mediaType,
    preview_url: previewUrl,
    media_url: previewUrl,
    status: 'staged',
    created_at: new Date().toISOString()
  };

  stagedMap.set(id, record);
  return record;
}

/**
 * Discards a staged attachment if it exists and matches the threadId (when bound).
 * Revokes its preview object URL to prevent memory leaks.
 * @param {Map<string, object>} stagedMap
 * @param {{ threadId?: string | null, attachmentId: string, revokePreviewUrl?: (url: string) => void }} params
 * @returns {boolean}
 */
export function discardMobileAttachment(stagedMap, { threadId = null, attachmentId, revokePreviewUrl }) {
  const key = String(attachmentId || '');
  if (!key || !stagedMap.has(key)) return false;

  const record = stagedMap.get(key);
  if (threadId != null && record?.thread_id != null && String(record.thread_id) !== String(threadId)) {
    return false;
  }

  stagedMap.delete(key);
  if (typeof revokePreviewUrl === 'function' && record?.preview_url && String(record.preview_url).startsWith('blob:')) {
    try {
      revokePreviewUrl(record.preview_url);
    } catch (_) {}
  }
  return true;
}

/**
 * Builds a non-colliding client_message_id when both attachment(s) and text
 * caption are sent in a single send operation.
 * @param {string | null | undefined} baseId
 * @param {boolean} isFollowupText
 * @param {number} [nowMs]
 * @returns {string}
 */
export function buildOutboundClientMessageId(baseId, isFollowupText, nowMs = Date.now()) {
  const cleanBase = String(baseId || '').trim() || `client_${nowMs}`;
  return isFollowupText ? `${cleanBase}_text` : cleanBase;
}
