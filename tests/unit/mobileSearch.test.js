import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchResults,
  buildSearchHighlight,
  tokenizeHighlight,
  searchMobileStore
} from '../../src/client/utils/mobileSearch.js';

describe('mobileSearch.js utilities', () => {
  describe('normalizeSearchResults', () => {
    test('returns array unchanged and converts non-arrays to empty array', () => {
      const sample = [{ id: '1', thread_id: 't1' }];
      assert.deepEqual(normalizeSearchResults(sample), sample);
      assert.deepEqual(normalizeSearchResults({ success: true, threads: [] }), []);
      assert.deepEqual(normalizeSearchResults({ error: 'Unauthorized' }), []);
      assert.deepEqual(normalizeSearchResults(null), []);
      assert.deepEqual(normalizeSearchResults(undefined), []);
    });
  });

  describe('buildSearchHighlight & tokenizeHighlight', () => {
    test('wraps case-insensitive matches with <mark> tags and strips pre-existing <mark>', () => {
      const hl = buildSearchHighlight('Xin chào <mark>khách</mark> hỏi giá sản phẩm', 'KHÁCH');
      assert.equal(hl, 'Xin chào <mark>khách</mark> hỏi giá sản phẩm');

      const tokens = tokenizeHighlight(hl);
      assert.deepEqual(tokens, [
        { text: 'Xin chào ', marked: false },
        { text: 'khách', marked: true },
        { text: ' hỏi giá sản phẩm', marked: false }
      ]);
    });

    test('preserves raw HTML characters as plain text tokens (no XSS execution)', () => {
      const raw = '<img src=x onerror=alert(1)> báo giá giúp mình';
      const hl = buildSearchHighlight(raw, 'báo giá');
      const tokens = tokenizeHighlight(hl);
      assert.equal(tokens.some((t) => t.marked && t.text === 'báo giá'), true);
      assert.equal(tokens.some((t) => !t.marked && t.text.includes('<img src=x onerror=alert(1)>')), true);
    });

    test('escapes regex special characters in query safely', () => {
      const hl = buildSearchHighlight('Giá 100.000đ (sale+)', '(sale+)');
      assert.equal(hl, 'Giá 100.000đ <mark>(sale+)</mark>');
    });
  });

  describe('searchMobileStore', () => {
    const sampleStore = {
      threads: [
        {
          id: 't1',
          account_id: 'acc_1',
          contact_name: 'Nguyễn Văn A',
          phone: '0912345678',
          last_message: 'Cho mình xin báo giá gói Pro nhé',
          last_activity: '2026-11-20T10:00:00.000Z'
        },
        {
          id: 't2',
          account_id: 'acc_1',
          contact_name: 'Trần Thị B',
          last_message: 'Cảm ơn shop nhiều',
          last_activity: '2026-11-21T12:00:00.000Z'
        }
      ],
      contactsByThread: {
        t2: { nickname: 'Chị B VIP', phone: '0987654321' }
      },
      messagesByThread: {
        t1: [
          {
            id: 'm1',
            sender_id: 'u1',
            content: 'Cho mình xin báo giá gói Pro nhé',
            is_outgoing: false,
            timestamp_ms: Date.parse('2026-11-20T10:00:00.000Z')
          },
          {
            id: 'm2',
            sender_id: 'page_1',
            content: 'Dạ giá gói Pro là 500k ạ',
            is_outgoing: true,
            timestamp_ms: Date.parse('2026-11-20T10:05:00.000Z')
          }
        ],
        t2: [
          {
            id: 'm3',
            sender_id: 'u2',
            content: 'Cảm ơn shop nhiều',
            is_outgoing: false,
            timestamp_ms: Date.parse('2026-11-21T12:00:00.000Z')
          }
        ]
      }
    };

    test('returns empty array for empty or whitespace query', () => {
      assert.deepEqual(searchMobileStore(sampleStore, ''), []);
      assert.deepEqual(searchMobileStore(sampleStore, '   '), []);
    });

    test('returns Desktop-compatible array matching messages sorted newest first', () => {
      const results = searchMobileStore(sampleStore, 'gói Pro');
      assert.equal(Array.isArray(results), true);
      assert.equal(results.length, 2);
      assert.equal(results[0].id, 'm2');
      assert.equal(results[0].thread_id, 't1');
      assert.equal(results[0].contact_name, 'Nguyễn Văn A');
      assert.equal(results[0].highlight.includes('<mark>gói Pro</mark>'), true);
      assert.equal(results[1].id, 'm1');
    });

    test('matches contact nickname and phone from contactsByThread', () => {
      const byNick = searchMobileStore(sampleStore, 'VIP');
      assert.equal(byNick.length, 1);
      assert.equal(byNick[0].id, 'thread:t2');
      assert.equal(byNick[0].thread_id, 't2');
      assert.equal(byNick[0].contact_name, 'Chị B VIP');

      const byPhone = searchMobileStore(sampleStore, '0987654321');
      assert.equal(byPhone.length, 1);
      assert.equal(byPhone[0].thread_id, 't2');
    });

    test('respects limit parameter', () => {
      const results = searchMobileStore(sampleStore, 'gói Pro', 1);
      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'm2');
    });
  });
});
