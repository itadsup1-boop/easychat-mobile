import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlobUrl,
  stripEphemeralBlobUrl,
  cleanLoadedBlobUrls,
  sanitizeStoreForPersistence,
  shouldIncrementSentInRun,
  canRetryRecipient,
  resolveCampaignEndStatus
} from '../../src/client/utils/mobileCampaigns.js';

describe('mobileCampaigns.js utilities', () => {
  test('blob URL detection and sanitization strips ephemeral blob: URLs without mutating live store', () => {
    assert.equal(isBlobUrl('blob:http://localhost/abc'), true);
    assert.equal(isBlobUrl('https://scontent.xx.fbcdn.net/img.jpg'), false);
    assert.equal(stripEphemeralBlobUrl('blob:http://localhost/abc'), null);
    assert.equal(stripEphemeralBlobUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');

    const liveStore = {
      messagesByThread: {
        t1: [
          { id: 'm1', media_url: 'blob:http://localhost/111' },
          { id: 'm2', media_url: 'https://cdn.example.com/real.jpg' }
        ]
      },
      campaigns: [
        {
          id: 'c1',
          messages: [{ id: 'cm1', attachments: [{ id: 'a1', preview_url: 'blob:http://localhost/222', media_url: 'blob:http://localhost/222' }] }]
        }
      ]
    };

    const persisted = sanitizeStoreForPersistence(liveStore);
    assert.equal(persisted.messagesByThread.t1[0].media_url, null);
    assert.equal(persisted.messagesByThread.t1[1].media_url, 'https://cdn.example.com/real.jpg');
    assert.equal(persisted.campaigns[0].messages[0].attachments[0].preview_url, null);
    // Live store keeps active blob URL for current session
    assert.equal(liveStore.messagesByThread.t1[0].media_url, 'blob:http://localhost/111');

    // Loading stale store cleans blob URLs in-place
    cleanLoadedBlobUrls(liveStore);
    assert.equal(liveStore.messagesByThread.t1[0].media_url, null);
    assert.equal(liveStore.campaigns[0].messages[0].attachments[0].preview_url, null);
  });

  test('shouldIncrementSentInRun only counts delivered recipients and canRetryRecipient respects max_retries', () => {
    assert.equal(shouldIncrementSentInRun({ status: 'sent' }), true);
    assert.equal(shouldIncrementSentInRun({ status: 'failed' }), false);
    assert.equal(shouldIncrementSentInRun({ status: 'pending' }), false);

    assert.equal(canRetryRecipient({ attempts: 1 }, 0), false);
    assert.equal(canRetryRecipient({ attempts: 1 }, 1), true);
    assert.equal(canRetryRecipient({ attempts: 2 }, 1), false);
    assert.equal(canRetryRecipient({ attempts: 2 }, 2), true);
  });

  test('resolveCampaignEndStatus pauses when pending remain after sendCap and completes accurately otherwise', () => {
    const capped = resolveCampaignEndStatus({ sent: 10, failed: 0, pending: 5 }, { hitSendCap: true, sendCap: 10 });
    assert.equal(capped.status, 'paused');
    assert.ok(capped.auditMessage.includes('10'));
    assert.ok(capped.auditMessage.includes('5'));

    const done = resolveCampaignEndStatus({ sent: 10, failed: 0, pending: 0 }, { hitSendCap: true, sendCap: 10 });
    assert.equal(done.status, 'completed');

    const partial = resolveCampaignEndStatus({ sent: 8, failed: 2, pending: 0 });
    assert.equal(partial.status, 'completed_with_errors');

    const failed = resolveCampaignEndStatus({ sent: 0, failed: 3, pending: 0 });
    assert.equal(failed.status, 'failed');
  });
});
