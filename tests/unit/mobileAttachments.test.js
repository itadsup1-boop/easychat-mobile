import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMediaType,
  toGraphAttachmentType,
  stageMobileAttachment,
  discardMobileAttachment,
  buildOutboundClientMessageId
} from '../../src/client/utils/mobileAttachments.js';

describe('mobileAttachments.js utilities', () => {
  test('classifyMediaType and toGraphAttachmentType handle image, video, voice, and file', () => {
    assert.equal(classifyMediaType('image/jpeg', 'photo.jpg'), 'image');
    assert.equal(classifyMediaType('video/mp4', 'clip.mp4'), 'video');
    assert.equal(classifyMediaType('audio/ogg', 'note.ogg'), 'voice');
    assert.equal(classifyMediaType('', 'report.pdf'), 'file');
    assert.equal(classifyMediaType('', 'voice.m4a'), 'voice');

    assert.equal(toGraphAttachmentType('image'), 'image');
    assert.equal(toGraphAttachmentType('video'), 'video');
    assert.equal(toGraphAttachmentType('voice'), 'audio');
    assert.equal(toGraphAttachmentType('file'), 'file');
  });

  test('stageMobileAttachment creates Desktop-compatible record and discardMobileAttachment revokes blob URL', () => {
    const stagedMap = new Map();
    const revoked = [];
    const fakeFile = { name: 'path/to/photo.png', type: 'image/png', size: 2048 };

    const record = stageMobileAttachment(stagedMap, {
      threadId: 'thread_1',
      file: fakeFile,
      createPreviewUrl: () => 'blob:http://localhost/abc-123'
    });

    assert.equal(record.thread_id, 'thread_1');
    assert.equal(record.original_name, 'path/to/photo.png');
    assert.equal(record.safe_name, 'path_to_photo.png');
    assert.equal(record.byte_size, 2048);
    assert.equal(record.media_type, 'image');
    assert.equal(record.preview_url, 'blob:http://localhost/abc-123');
    assert.equal(stagedMap.has(record.id), true);

    // Wrong thread cannot discard
    const wrongDiscard = discardMobileAttachment(stagedMap, {
      threadId: 'thread_other',
      attachmentId: record.id,
      revokePreviewUrl: (u) => revoked.push(u)
    });
    assert.equal(wrongDiscard, false);
    assert.equal(stagedMap.has(record.id), true);
    assert.equal(revoked.length, 0);

    // Correct thread discards and revokes object URL
    const okDiscard = discardMobileAttachment(stagedMap, {
      threadId: 'thread_1',
      attachmentId: record.id,
      revokePreviewUrl: (u) => revoked.push(u)
    });
    assert.equal(okDiscard, true);
    assert.equal(stagedMap.has(record.id), false);
    assert.deepEqual(revoked, ['blob:http://localhost/abc-123']);

    // Second discard returns false
    assert.equal(discardMobileAttachment(stagedMap, { threadId: 'thread_1', attachmentId: record.id }), false);
  });

  test('buildOutboundClientMessageId avoids collisions for follow-up text messages', () => {
    assert.equal(buildOutboundClientMessageId('client_123', false), 'client_123');
    assert.equal(buildOutboundClientMessageId('client_123', true), 'client_123_text');
    assert.equal(buildOutboundClientMessageId('', false, 999), 'client_999');
  });
});
