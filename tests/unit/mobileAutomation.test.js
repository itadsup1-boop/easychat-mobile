import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  listMobileAutoReplyRules,
  createMobileAutoReplyRule,
  toggleMobileAutoReplyRule,
  deleteMobileAutoReplyRule,
  addMobileAutoReplyKeywords,
  toggleMobileAutoReplyKeyword,
  deleteMobileAutoReplyKeyword,
  getMobileAiConfig,
  saveMobileAiConfig,
  getMobilePhoneAutomation,
  saveMobilePhoneAutomation,
  deleteMobileLeadStatus,
  deleteMobileQuickTemplate,
  extractSafeVietnamPhone,
  applyMobilePhoneAutomation,
  getMobileBroadcastQuota,
  consumeMobileBroadcastQuota,
  renderBroadcastTemplate,
  resolveThreadPageSource
} from '../../src/client/utils/mobileAutomation.js';

describe('mobileAutomation.js utilities', () => {
  test('Auto-Reply full CRUD lifecycle (rules + keywords)', () => {
    const store = { autoReplyRules: [] };

    const invalid = createMobileAutoReplyRule(store, 'acc_1', { keywords: [], response_template: '' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.status, 400);

    const created = createMobileAutoReplyRule(store, 'acc_1', {
      keywords: ['giá', 'báo giá', 'GIÁ'],
      response_template: 'Chào {name}, giá gói Pro là 500k'
    });
    assert.equal(created.ok, true);
    assert.equal(created.status, 201);
    assert.equal(created.data.rule.keywords.length, 2);

    const ruleId = created.data.rule.id;
    const listed = listMobileAutoReplyRules(store, 'acc_1');
    assert.equal(listed.length, 1);
    assert.equal(listMobileAutoReplyRules(store, 'acc_other').length, 0);

    const toggled = toggleMobileAutoReplyRule(store, ruleId, false);
    assert.equal(toggled.ok, true);
    assert.equal(toggled.data.is_active, 0);

    const addedKw = addMobileAutoReplyKeywords(store, ruleId, 'ship, khuyến mãi, giá');
    assert.equal(addedKw.ok, true);
    assert.equal(addedKw.data.keywords.length, 2);

    const kwId = addedKw.data.keywords[0].id;
    const kwToggled = toggleMobileAutoReplyKeyword(store, kwId, false);
    assert.equal(kwToggled.ok, true);
    assert.equal(kwToggled.data.is_active, 0);

    const kwDeleted = deleteMobileAutoReplyKeyword(store, kwId);
    assert.equal(kwDeleted.ok, true);

    const deleted = deleteMobileAutoReplyRule(store, ruleId);
    assert.equal(deleted.ok, true);
    assert.equal(listMobileAutoReplyRules(store, 'acc_1').length, 0);
  });

  test('AI Config per-account save and read', () => {
    const store = { aiConfig: {}, aiConfigByAccount: {} };

    const initial = getMobileAiConfig(store, 'acc_1');
    assert.equal(initial.provider, 'LOCAL_OLLAMA');
    assert.equal(initial.model_name, 'llama3');

    const saved = saveMobileAiConfig(store, 'acc_1', {
      provider: 'CLOUD_OPENAI',
      api_key: 'sk-test',
      model_name: 'gpt-4o',
      system_prompt: 'Tư vấn ngắn gọn',
      is_active: true
    });
    assert.equal(saved.provider, 'CLOUD_OPENAI');
    assert.equal(saved.model_name, 'gpt-4o');
    assert.equal(saved.is_active, 1);
    assert.equal(saved.has_api_key, true);

    const fetched = getMobileAiConfig(store, 'acc_1');
    assert.equal(fetched.model_name, 'gpt-4o');
    assert.equal(fetched.system_prompt, 'Tư vấn ngắn gọn');
  });

  test('Phone Automation settings validate enabled + status_id and persist', () => {
    const store = { phoneAutomation: {} };

    const bad = saveMobilePhoneAutomation(store, { enabled: true, status_id: '' });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);

    const ok = saveMobilePhoneAutomation(store, { enabled: true, status_id: '3' });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.enabled, true);
    assert.equal(ok.data.status_id, '3');

    const read = getMobilePhoneAutomation(store);
    assert.equal(read.enabled, true);
    assert.equal(read.status_id, '3');
  });

  test('deleteMobileLeadStatus cleans up threads/contacts and deleteMobileQuickTemplate removes template', () => {
    const store = {
      leadStatuses: [{ id: 2, name: 'Đang tư vấn', color: '#f59e0b' }],
      threads: [{ id: 't1', status_id: 2, status_name: 'Đang tư vấn', status_color: '#f59e0b' }],
      contactsByThread: { t1: { thread_id: 't1', status_id: 2, lead_status_id: 2 } },
      quickTemplates: [{ id: 10, shortcut: '/gia', content: '500k' }]
    };

    deleteMobileLeadStatus(store, 2);
    assert.equal(store.leadStatuses.length, 0);
    assert.equal(store.threads[0].status_id, null);
    assert.equal(store.contactsByThread.t1.status_id, null);

    const delTpl = deleteMobileQuickTemplate(store, 10);
    assert.equal(delTpl.ok, true);
    assert.equal(store.quickTemplates.length, 0);
    assert.equal(deleteMobileQuickTemplate(store, 10).status, 404);
  });

  test('extractSafeVietnamPhone captures valid VN numbers and rejects prices/long digits', () => {
    assert.equal(extractSafeVietnamPhone('SĐT mình là 0912.345.678 nhé'), '0912345678');
    assert.equal(extractSafeVietnamPhone('Liên hệ +84 987-654-321'), '0987654321');
    assert.equal(extractSafeVietnamPhone('Giá 100.500.000.000 đồng'), null);
    assert.equal(extractSafeVietnamPhone('Mã đơn 100500000000'), null);
  });

  test('applyMobilePhoneAutomation auto-updates Lead Status when enabled and respects disabled state', () => {
    const store = {
      leadStatuses: [{ id: 3, name: 'Đã xin SĐT', color: '#8b5cf6' }],
      phoneAutomation: { enabled: true, status_id: 3 },
      contactsByThread: {}
    };

    const res = applyMobilePhoneAutomation(store, 't1', '0912345678', 'Nguyễn A');
    assert.equal(res.phoneCaptured, true);
    assert.equal(res.statusApplied, true);
    assert.equal(store.contactsByThread.t1.phone, '0912345678');
    assert.equal(store.contactsByThread.t1.status_id, 3);
    assert.equal(store.contactsByThread.t1.status_name, 'Đã xin SĐT');
    assert.equal(store.contactsByThread.t1.status_color, '#8b5cf6');

    const disabledStore = {
      leadStatuses: [{ id: 3, name: 'Đã xin SĐT', color: '#8b5cf6' }],
      phoneAutomation: { enabled: false, status_id: 3 },
      contactsByThread: {}
    };
    const resOff = applyMobilePhoneAutomation(disabledStore, 't2', '0987654321', 'Trần B');
    assert.equal(resOff.phoneCaptured, true);
    assert.equal(resOff.statusApplied, false);
    assert.equal(disabledStore.contactsByThread.t2.status_id, undefined);
  });

  test('Broadcast quota tracks daily usage and renderBroadcastTemplate replaces customer name', () => {
    const store = { broadcastQuotaByAccount: {} };
    const q0 = getMobileBroadcastQuota(store, 'acc_1', '2026-11-26');
    assert.equal(q0.used, 0);
    assert.equal(q0.remaining, 150);

    const q1 = consumeMobileBroadcastQuota(store, 'acc_1', 10, '2026-11-26');
    assert.equal(q1.used, 10);
    assert.equal(q1.remaining, 140);

    // Next day resets automatically
    const qNextDay = getMobileBroadcastQuota(store, 'acc_1', '2026-11-27');
    assert.equal(qNextDay.used, 0);
    assert.equal(qNextDay.remaining, 150);

    assert.equal(
      renderBroadcastTemplate('Chào {ten_khach_hang}, ưu đãi riêng cho {name}!', 'Lan'),
      'Chào Lan, ưu đãi riêng cho Lan!'
    );
  });

  test('resolveThreadPageSource strictly matches owning Fanpage and never falls back to another Page', () => {
    const sources = [
      { id: 'src_page_100', source_type: 'page_messenger', external_id: '100', display_name: 'Shop A', status: 'ACTIVE', token: '' },
      { id: 'src_page_200', source_type: 'page_messenger', external_id: '200', display_name: 'Shop B', status: 'ACTIVE', token: 'tok_b' },
      { id: 'src_personal_999', source_type: 'personal_messenger', external_id: '999', display_name: 'Nick Cá Nhân', status: 'ACTIVE' }
    ];

    // Matches owning Page B by source_id
    const okById = resolveThreadPageSource({ id: 'psid_1', source_id: 'src_page_200', source_type: 'page_messenger' }, sources);
    assert.equal(okById.ok, true);
    assert.equal(okById.source.external_id, '200');

    // Matches owning Page B via page:<pageId>:<psid> thread id
    const okByEmbedded = resolveThreadPageSource({ id: 'page:200:psid_2' }, sources);
    assert.equal(okByEmbedded.ok, true);
    assert.equal(okByEmbedded.source.external_id, '200');

    // Owning Page A has no token -> MUST fail with PAGE_TOKEN_MISSING, never fall back to Page B
    const missingToken = resolveThreadPageSource({ id: 'psid_3', source_id: 'src_page_100', source_type: 'page_messenger' }, sources);
    assert.equal(missingToken.ok, false);
    assert.equal(missingToken.code, 'PAGE_TOKEN_MISSING');
    assert.ok(missingToken.error.includes('Shop A'));

    // Personal account thread -> MUST fail cleanly, never fall back to Page B
    const personal = resolveThreadPageSource({ id: 't_personal', source_id: 'src_personal_999', source_type: 'personal_messenger' }, sources);
    assert.equal(personal.ok, false);
    assert.equal(personal.code, 'PERSONAL_THREAD_UNSUPPORTED_STANDALONE');

    // Unknown source -> MUST fail cleanly
    const unknown = resolveThreadPageSource({ id: 'psid_orphan' }, sources);
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'PAGE_SOURCE_NOT_FOUND');
  });
});
