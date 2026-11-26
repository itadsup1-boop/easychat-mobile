import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCompanyEmployeesPayload,
  listMobileAssignableAccounts,
  buildMobileCompanyEmployeesPayload,
  addMobileEmployee,
  findMobileEmployeeById,
  setMobileEmployeeAssignments,
  removeMobileEmployee
} from '../../src/client/utils/mobileEmployees.js';

describe('mobileEmployees.js utilities', () => {
  test('normalizeCompanyEmployeesPayload always produces safe arrays and assignments map', () => {
    const empty = normalizeCompanyEmployeesPayload({ success: true });
    assert.deepEqual(empty.employees, []);
    assert.deepEqual(empty.accounts, []);
    assert.deepEqual(empty.assignments, {});

    const broken = normalizeCompanyEmployeesPayload({
      success: true,
      employees: null,
      accounts: 'invalid',
      assignments: []
    });
    assert.deepEqual(broken.employees, []);
    assert.deepEqual(broken.accounts, []);
    assert.deepEqual(broken.assignments, {});
  });

  test('listMobileAssignableAccounts combines accounts and active inboxSources without duplicates', () => {
    const store = {
      accounts: [{ id: '1001', name: 'FB Cá nhân 1' }],
      inboxSources: [
        { id: 'src_page_2001', external_id: '2001', display_name: 'Fanpage A', source_type: 'page_messenger', status: 'ACTIVE' },
        { id: 'src_page_2002', external_id: '2002', display_name: 'Fanpage Off', source_type: 'page_messenger', status: 'DISCONNECTED' },
        { id: 'src_personal_1001', external_id: '1001', display_name: 'Duplicate', source_type: 'personal_messenger', status: 'ACTIVE' }
      ]
    };

    const accounts = listMobileAssignableAccounts(store);
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].id, '1001');
    assert.equal(accounts[1].id, '2001');
    assert.equal(accounts[1].name, 'Fanpage A');
  });

  test('add, assign, list, and remove employee lifecycle', () => {
    const store = {
      employees: [],
      employeeAssignments: {},
      accounts: [{ id: 'acc_1', name: 'Tài khoản 1' }],
      inboxSources: [{ id: 'src_page_99', external_id: '99', display_name: 'Shop 99', source_type: 'page_messenger', status: 'ACTIVE' }]
    };

    const created = addMobileEmployee(store, { id: 101, username: 'nhanvien1' });
    assert.equal(created.id, 101);
    assert.equal(created.username, 'nhanvien1');
    assert.ok(findMobileEmployeeById(store, '101'));

    const assigned = setMobileEmployeeAssignments(store, '101', ['acc_1', '99', 'acc_1']);
    assert.deepEqual(assigned, ['acc_1', '99']);

    const payload = buildMobileCompanyEmployeesPayload(store);
    assert.equal(payload.success, true);
    assert.equal(payload.employees.length, 1);
    assert.equal(payload.accounts.length, 2);
    assert.deepEqual(payload.assignments['101'], ['acc_1', '99']);

    assert.equal(setMobileEmployeeAssignments(store, '999', ['acc_1']), null);

    const removed = removeMobileEmployee(store, '101');
    assert.equal(removed?.username, 'nhanvien1');
    assert.equal(store.employees.length, 0);
    assert.equal(store.employeeAssignments['101'], undefined);
    assert.equal(removeMobileEmployee(store, '101'), null);
  });
});
