/**
 * Pure utilities for Mobile Campaign Runner & ephemeral blob: URL sanitization.
 */

export function isBlobUrl(url) {
  return typeof url === 'string' && /^blob:/i.test(url.trim());
}

export function stripEphemeralBlobUrl(url) {
  return isBlobUrl(url) ? null : url;
}

/**
 * Cleans legacy dead blob: URLs from loaded store data after an app reload.
 * Mutates messagesByThread and campaigns arrays in the normalized store copy.
 * @param {object} store
 */
export function cleanLoadedBlobUrls(store) {
  if (!store || typeof store !== 'object') return store;

  if (store.messagesByThread && typeof store.messagesByThread === 'object') {
    for (const tid of Object.keys(store.messagesByThread)) {
      const msgs = store.messagesByThread[tid];
      if (!Array.isArray(msgs)) continue;
      store.messagesByThread[tid] = msgs.map((m) => {
        if (!m || typeof m !== 'object') return m;
        if (!isBlobUrl(m.media_url) && !isBlobUrl(m.preview_url)) return m;
        return {
          ...m,
          media_url: stripEphemeralBlobUrl(m.media_url),
          ...(m.preview_url !== undefined ? { preview_url: stripEphemeralBlobUrl(m.preview_url) } : {})
        };
      });
    }
  }

  if (Array.isArray(store.campaigns)) {
    store.campaigns = store.campaigns.map((camp) => {
      if (!camp || !Array.isArray(camp.messages)) return camp;
      return {
        ...camp,
        messages: camp.messages.map((m) => {
          if (!m || !Array.isArray(m.attachments)) return m;
          return {
            ...m,
            attachments: m.attachments.map((att) => {
              if (!att || (!isBlobUrl(att.preview_url) && !isBlobUrl(att.media_url))) return att;
              return {
                ...att,
                preview_url: stripEphemeralBlobUrl(att.preview_url),
                media_url: stripEphemeralBlobUrl(att.media_url)
              };
            })
          };
        })
      };
    });
  }

  return store;
}

/**
 * Produces a persistence-safe clone of store without ephemeral blob: URLs,
 * leaving the live in-memory store untouched for active session previews.
 * @param {object} store
 */
export function sanitizeStoreForPersistence(store) {
  if (!store || typeof store !== 'object') return store;

  const cleanMessagesByThread = {};
  if (store.messagesByThread && typeof store.messagesByThread === 'object') {
    for (const tid of Object.keys(store.messagesByThread)) {
      const msgs = store.messagesByThread[tid];
      cleanMessagesByThread[tid] = Array.isArray(msgs)
        ? msgs.map((m) => {
            if (!m || typeof m !== 'object') return m;
            if (!isBlobUrl(m.media_url) && !isBlobUrl(m.preview_url)) return m;
            return {
              ...m,
              media_url: stripEphemeralBlobUrl(m.media_url),
              ...(m.preview_url !== undefined ? { preview_url: stripEphemeralBlobUrl(m.preview_url) } : {})
            };
          })
        : [];
    }
  }

  const cleanCampaigns = Array.isArray(store.campaigns)
    ? store.campaigns.map((camp) => {
        if (!camp || !Array.isArray(camp.messages)) return camp;
        return {
          ...camp,
          messages: camp.messages.map((m) => {
            if (!m || !Array.isArray(m.attachments)) return m;
            return {
              ...m,
              attachments: m.attachments.map((att) => {
                if (!att || (!isBlobUrl(att.preview_url) && !isBlobUrl(att.media_url))) return att;
                return {
                  ...att,
                  preview_url: stripEphemeralBlobUrl(att.preview_url),
                  media_url: stripEphemeralBlobUrl(att.media_url)
                };
              })
            };
          })
        };
      })
    : [];

  return {
    ...store,
    messagesByThread: cleanMessagesByThread,
    campaigns: cleanCampaigns
  };
}

/**
 * Returns true only when the recipient was actually delivered successfully.
 * Failed recipients must not consume sendCap.
 * @param {object} recipient
 */
export function shouldIncrementSentInRun(recipient) {
  return recipient?.status === 'sent';
}

/**
 * Checks whether a failed recipient still has retry budget remaining.
 * @param {object} recipient
 * @param {number} maxRetries
 */
export function canRetryRecipient(recipient, maxRetries) {
  const allowedRetries = Math.max(0, Number(maxRetries || 0));
  const attempts = Math.max(0, Number(recipient?.attempts || 0));
  return attempts <= allowedRetries;
}

/**
 * Computes the final campaign status when the runner loop finishes a run.
 * If pending recipients remain (e.g. sendCap reached), pauses the campaign
 * instead of falsely marking it completed.
 * @param {{ sent?: number, failed?: number, pending?: number }} counts
 * @param {{ hitSendCap?: boolean, sendCap?: number }} [options]
 */
export function resolveCampaignEndStatus(counts = {}, { hitSendCap = false, sendCap = 0 } = {}) {
  const sent = Number(counts?.sent || 0);
  const failed = Number(counts?.failed || 0);
  const pending = Number(counts?.pending || 0);

  if (pending > 0) {
    const message = hitSendCap
      ? `Đã đạt giới hạn gửi (${sendCap} tin) — tạm dừng, còn ${pending} khách chờ gửi tiếp`
      : `Tạm dừng: đã gửi ${sent}, lỗi ${failed}, còn ${pending} khách chờ gửi`;
    return { status: 'paused', auditMessage: message };
  }

  if (failed > 0 && sent > 0) {
    return { status: 'completed_with_errors', auditMessage: `Hoàn tất (có lỗi): đã gửi ${sent}, lỗi ${failed}` };
  }
  if (failed > 0 && sent === 0) {
    return { status: 'failed', auditMessage: `Thất bại: đã gửi 0, lỗi ${failed}` };
  }
  return { status: 'completed', auditMessage: `Hoàn tất: đã gửi ${sent}, lỗi ${failed}` };
}
