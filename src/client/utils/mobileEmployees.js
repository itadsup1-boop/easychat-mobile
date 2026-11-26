/**
 * Pure utilities for Company Employee Management in Mobile Standalone Engine
 * & defensive normalization in EmployeeManagementModal.
 */

/**
 * Normalizes any /api/company/employees response payload so UI components
 * always receive arrays for employees/accounts and an object for assignments.
 * @param {unknown} payload
 * @returns {{ success: boolean, employees: Array<object>, accounts: Array<object>, assignments: Record<string, string[]> }}
 */
export function normalizeCompanyEmployeesPayload(payload) {
  const src = payload && typeof payload === 'object' ? payload : {};
  return {
    ...src,
    success: Boolean(src.success),
    employees: Array.isArray(src.employees) ? src.employees : [],
    accounts: Array.isArray(src.accounts) ? src.accounts : [],
    assignments: src.assignments && typeof src.assignments === 'object' && !Array.isArray(src.assignments)
      ? src.assignments
      : {}
  };
}

/**
 * Builds the list of assignable Facebook accounts/pages from the mobile store.
 * @param {object} store
 * @returns {Array<{ id: string, name: string, source_type?: string }>}
 */
export function listMobileAssignableAccounts(store) {
  const seen = new Set();
  const list = [];

  const accounts = Array.isArray(store?.accounts) ? store.accounts : [];
  for (const acc of accounts) {
    if (!acc || acc.id == null) continue;
    const id = String(acc.id);
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      name: acc.name || acc.display_name || `FB Account (${id})`,
      source_type: acc.source_type || 'personal_messenger'
    });
  }

  const sources = Array.isArray(store?.inboxSources) ? store.inboxSources : [];
  for (const src of sources) {
    if (!src || src.status === 'DISCONNECTED') continue;
    const id = String(src.external_id || src.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      name: src.display_name || src.name || `Page (${id})`,
      source_type: src.source_type || 'page_messenger'
    });
  }

  return list;
}

/**
 * Builds the GET /api/company/employees response matching Desktop server.js.
 * @param {object} store
 */
export function buildMobileCompanyEmployeesPayload(store) {
  const employees = Array.isArray(store?.employees)
    ? store.employees.filter((e) => e && e.id != null)
    : [];
  const rawAssignments = store?.employeeAssignments && typeof store.employeeAssignments === 'object'
    ? store.employeeAssignments
    : {};

  const assignments = {};
  for (const emp of employees) {
    const key = String(emp.id);
    const assigned = rawAssignments[key];
    assignments[key] = Array.isArray(assigned) ? assigned.map(String) : [];
  }

  return {
    success: true,
    employees,
    accounts: listMobileAssignableAccounts(store),
    assignments
  };
}

/**
 * Adds or updates an employee record in the mobile store.
 * @param {object} store
 * @param {object} rawEmployee
 * @returns {object}
 */
export function addMobileEmployee(store, rawEmployee) {
  if (!Array.isArray(store.employees)) store.employees = [];
  if (!store.employeeAssignments || typeof store.employeeAssignments !== 'object') {
    store.employeeAssignments = {};
  }

  const username = String(rawEmployee?.username || '').trim();
  const existingByUsername = store.employees.find(
    (e) => String(e?.username || '').toLowerCase() === username.toLowerCase()
  );

  const id = rawEmployee?.id != null
    ? rawEmployee.id
    : (existingByUsername?.id != null ? existingByUsername.id : Date.now());

  const employee = {
    id,
    username,
    company_role: rawEmployee?.company_role || 'EMPLOYEE',
    status: rawEmployee?.status || 'ACTIVE',
    created_at: rawEmployee?.created_at || new Date().toISOString()
  };

  if (existingByUsername) {
    Object.assign(existingByUsername, employee);
  } else {
    store.employees.push(employee);
  }

  const key = String(employee.id);
  if (!Array.isArray(store.employeeAssignments[key])) {
    store.employeeAssignments[key] = [];
  }

  return employee;
}

/**
 * Finds an employee by ID (string/number agnostic).
 * @param {object} store
 * @param {string|number} employeeId
 */
export function findMobileEmployeeById(store, employeeId) {
  const target = String(employeeId ?? '');
  if (!target || !Array.isArray(store?.employees)) return null;
  return store.employees.find((e) => String(e?.id) === target) || null;
}

/**
 * Replaces the assigned account IDs for an employee.
 * @param {object} store
 * @param {string|number} employeeId
 * @param {unknown[]} accountIds
 * @returns {string[] | null} null if employee does not exist
 */
export function setMobileEmployeeAssignments(store, employeeId, accountIds) {
  const emp = findMobileEmployeeById(store, employeeId);
  if (!emp) return null;

  if (!store.employeeAssignments || typeof store.employeeAssignments !== 'object') {
    store.employeeAssignments = {};
  }

  const normalized = [];
  const seen = new Set();
  for (const rawId of (Array.isArray(accountIds) ? accountIds : [])) {
    const id = String(rawId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  store.employeeAssignments[String(emp.id)] = normalized;
  return normalized;
}

/**
 * Removes an employee and clears their assignments from the mobile store.
 * @param {object} store
 * @param {string|number} employeeId
 * @returns {object | null} removed employee or null if not found
 */
export function removeMobileEmployee(store, employeeId) {
  const target = String(employeeId ?? '');
  if (!target || !Array.isArray(store?.employees)) return null;

  const idx = store.employees.findIndex((e) => String(e?.id) === target);
  if (idx === -1) return null;

  const [removed] = store.employees.splice(idx, 1);
  if (store.employeeAssignments && typeof store.employeeAssignments === 'object') {
    delete store.employeeAssignments[String(removed.id)];
    delete store.employeeAssignments[target];
  }
  return removed;
}
