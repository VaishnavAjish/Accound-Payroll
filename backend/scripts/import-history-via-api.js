require('dotenv').config();

const path = require('path');
const XLSX = require('xlsx');
const db = require('../db');
const { generateToken } = require('../middleware/auth');

const API_BASE = process.env.IMPORT_API_BASE || 'http://127.0.0.1:8000';
const IMPORT_USER_EMAIL = process.env.IMPORT_USER_EMAIL || 'superadmin@nidhiimpex.com';

const FILES = [
  { file: 'April-2026.xlsx', name: 'April 2026', start_date: '2026-04-01', end_date: '2026-04-30' },
  { file: 'May-2026.xlsx', name: 'May 2026', start_date: '2026-05-01', end_date: '2026-05-31' },
  { file: 'June - 2026.xlsx', name: 'June 2026', start_date: '2026-06-01', end_date: '2026-06-30' },
];

const ROUND_SHAPES = new Set(['ROUND', 'OLD EUROPEAN BRILLIANT', 'OEB', 'ROUND_OEB', 'ROUND OEB']);
const BULK_SIZE = 75;

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function cleanNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toIsoDate(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;

  let date = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    date = value;
  } else if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  } else {
    const text = String(value).trim();
    let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (!date) {
      match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (match) date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
    }
  }

  if (!date || Number.isNaN(date.getTime())) return fallback;
  const year = date.getUTCFullYear();
  if (year < 2026 || year > 2026) return fallback;
  return `${year}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function normalizeDepartment(value) {
  const match = String(value || '').match(/POLISH[-_\s]*(\d+)/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number >= 1 && number <= 15 ? `POLISH_${number}` : null;
}

function normalizeShape(value) {
  return cleanText(value) || 'Oval';
}

function normalizeLab(shape, value) {
  const shapeKey = normalizeShape(shape).trim().toUpperCase();
  const lab = cleanText(value);
  if (ROUND_SHAPES.has(shapeKey)) return 'US';
  if (['IGI', 'GIA'].includes((lab || '').toUpperCase())) return lab.toUpperCase();
  return 'IGI';
}

function safeReceivedDate(rawValue, issueDate, periodEnd) {
  const receivedDate = toIsoDate(rawValue, issueDate);
  if (!receivedDate || receivedDate < issueDate) return issueDate;
  if (receivedDate > periodEnd) return periodEnd;
  return receivedDate;
}

function workbookRows(file, sheetName) {
  const workbook = XLSX.readFile(path.join(__dirname, '..', '..', file), { cellDates: true });
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true }).slice(1);
}

function uniqueLot(lotId, lotName, seenLots, stats) {
  const baseLotId = cleanText(lotId) || 'UNKNOWN';
  const baseLotName = cleanText(lotName) || 'UNKNOWN';
  const key = `${baseLotId.toLowerCase()}::${baseLotName.toLowerCase()}`;
  const count = (seenLots.get(key) || 0) + 1;
  seenLots.set(key, count);
  if (count === 1) return { lot_id: baseLotId, lot_name: baseLotName };
  stats.duplicateLotsAdjusted += 1;
  return { lot_id: `${baseLotId}-DUP${count}`, lot_name: baseLotName };
}

function chunks(rows, size) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

async function api(token, method, url, body) {
  const response = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error || `${method} ${url} failed with ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function ensurePeriod(token, period) {
  const periods = await api(token, 'GET', '/periods');
  const existing = periods.find((row) => row.name === period.name);
  if (existing) {
    if (existing.status === 'CLOSED') return api(token, 'POST', `/periods/${existing.id}/reopen`, {});
    return existing;
  }
  return api(token, 'POST', '/periods', period);
}

async function closeLaterOpenPeriods(token, firstImportStart) {
  const periods = await api(token, 'GET', '/periods');
  const toReopen = periods.filter((period) => period.status === 'OPEN' && period.start_date > firstImportStart);
  for (const period of toReopen) {
    await api(token, 'POST', `/periods/${period.id}/close`, {});
  }
  return toReopen;
}

async function reopenPeriods(token, periods) {
  for (const period of periods) {
    try {
      await api(token, 'POST', `/periods/${period.id}/reopen`, {});
    } catch (err) {
      console.warn(`Could not reopen ${period.name}: ${err.message}`);
    }
  }
}

async function ensureEmployees(token, employeeDefs, stats) {
  const byCode = new Map();
  const existing = await api(token, 'GET', '/employees?includeInactive=true');
  for (const employee of existing) {
    if (employee.current_code) byCode.set(String(employee.current_code), employee);
  }

  for (const [code, employee] of employeeDefs.entries()) {
    if (byCode.has(code)) continue;
    const created = await api(token, 'POST', '/employees', {
      code,
      name: employee.name,
      department: employee.department,
      specialist: employee.specialist,
      work_status: 'WORKING',
    });
    byCode.set(code, created);
    stats.employeesCreated += 1;
  }

  return byCode;
}

async function bulkIssuePolish(token, employeeId, rows, stats) {
  const created = [];
  for (const chunk of chunks(rows, BULK_SIZE)) {
    const inserted = await api(token, 'POST', '/polish/bulk', { employee_id: employeeId, entries: chunk });
    created.push(...inserted);
    stats.polishIssued += inserted.length;
  }
  return created;
}

async function bulkIssueDhar(token, employeeId, rows, stats) {
  const created = [];
  for (const chunk of chunks(rows, BULK_SIZE)) {
    const inserted = await api(token, 'POST', '/dhar/bulk', { employee_id: employeeId, entries: chunk });
    created.push(...inserted);
    stats.dharIssued += inserted.length;
  }
  return created;
}

async function completePolishRows(token, issuedRows, sourceRows, stats) {
  for (let index = 0; index < issuedRows.length; index += 1) {
    const issued = issuedRows[index];
    const source = sourceRows[index];
    await api(token, 'PATCH', `/polish/${issued.id}/complete`, {
      received_date: source.received_date,
      labour_head: source.labour_head,
      polished_weight: source.polished_weight,
      color: source.color,
      shade: source.shade,
      clarity: source.clarity,
      cut_pol_sym: source.cut_pol_sym,
      grader: source.grader,
      stone_level: source.stone_level,
      lab_name: source.lab_name,
      remarks: source.remarks,
    });
    stats.polishCompleted += 1;
  }
}

async function returnDharRows(token, issuedRows, sourceRows, stats) {
  for (let index = 0; index < issuedRows.length; index += 1) {
    const issued = issuedRows[index];
    const source = sourceRows[index];
    await api(token, 'PATCH', `/dhar/${issued.id}/return`, {
      received_date: source.received_date,
      remarks: source.remarks,
    });
    stats.dharReturned += 1;
  }
}

async function main() {
  const stats = {
    employeesCreated: 0,
    periodsOpened: 0,
    polishIssued: 0,
    polishCompleted: 0,
    dharIssued: 0,
    dharReturned: 0,
    duplicateLotsAdjusted: 0,
    skippedRows: 0,
  };

  const health = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Backend API is not running at ${API_BASE}. Start backend first.`);

  const user = await db('users').where({ email: IMPORT_USER_EMAIL }).first();
  if (!user) throw new Error(`Import user not found: ${IMPORT_USER_EMAIL}`);
  const token = generateToken(user);

  const employeeDefs = new Map();
  for (const period of FILES) {
    for (const sheetName of ['Polish', 'Dhar']) {
      for (const row of workbookRows(period.file, sheetName)) {
        const department = normalizeDepartment(row[1]);
        const code = cleanText(row[2]);
        if (!department || !code) continue;
        if (!employeeDefs.has(code)) {
          employeeDefs.set(code, {
            department,
            name: code.startsWith('DHAR-') ? `DHAR Employee ${code}` : `Employee ${code}`,
            specialist: code.startsWith('DHAR-') ? 'DHAR' : 'POLISH',
          });
        }
      }
    }
  }

  const closedForImport = await closeLaterOpenPeriods(token, FILES[0].start_date);
  try {
    const employeesByCode = await ensureEmployees(token, employeeDefs, stats);
    const seenLots = new Map();

    for (const period of FILES) {
      await ensurePeriod(token, period);
      stats.periodsOpened += 1;

      const polishByEmployee = new Map();
      for (const row of workbookRows(period.file, 'Polish')) {
        const code = cleanText(row[2]);
        const employee = employeesByCode.get(code);
        if (!employee) {
          stats.skippedRows += 1;
          continue;
        }

        const issueDate = toIsoDate(row[4], period.start_date);
        const sendWeight = cleanNumber(row[9], 0);
        const shape = normalizeShape(row[8]);
        const labourHead = cleanText(row[11]) || 'Full Polished';
        const lot = uniqueLot(row[5], row[6], seenLots, stats);
        const prepared = {
          employee_id: employee.id,
          issue_date: issueDate,
          ...lot,
          qty: cleanNumber(row[7], 1),
          shape,
          send_weight: sendWeight,
          estimate_weight: cleanNumber(row[10], sendWeight),
          labour_head: labourHead,
          received_date: safeReceivedDate(row[12], issueDate, period.end_date),
          polished_weight: cleanNumber(row[13], sendWeight),
          color: cleanText(row[14]) || '-',
          shade: cleanText(row[15]) || '-',
          clarity: cleanText(row[16]) || '-',
          cut_pol_sym: cleanText(row[17]) || '-',
          grader: cleanText(row[18]) || '-',
          stone_level: cleanText(row[19]) || '-',
          lab_name: normalizeLab(shape, row[20]),
          remarks: cleanText(row[21]),
        };

        if (!polishByEmployee.has(employee.id)) polishByEmployee.set(employee.id, []);
        polishByEmployee.get(employee.id).push(prepared);
      }

      for (const [employeeId, rows] of polishByEmployee.entries()) {
        const issueRows = rows.map(({ received_date, polished_weight, color, shade, clarity, cut_pol_sym, grader, stone_level, lab_name, remarks, ...issue }) => issue);
        const issued = await bulkIssuePolish(token, employeeId, issueRows, stats);
        await completePolishRows(token, issued, rows, stats);
      }

      const dharByEmployee = new Map();
      for (const row of workbookRows(period.file, 'Dhar')) {
        const code = cleanText(row[2]);
        const employee = employeesByCode.get(code);
        if (!employee) {
          stats.skippedRows += 1;
          continue;
        }

        const issueDate = toIsoDate(row[4], period.end_date);
        const weight = cleanNumber(row[7], 0);
        const lot = uniqueLot(row[5], row[6], seenLots, stats);
        const prepared = {
          employee_id: employee.id,
          issue_date: issueDate,
          ...lot,
          weight,
          shape_classification: 'ALL_SHAPE',
          received_date: issueDate,
          remarks: `Range: ${cleanText(row[8]) || '-'}; True Range: ${cleanText(row[9]) || '-'}; Different: ${cleanText(row[10]) || '-'}`,
        };

        if (!dharByEmployee.has(employee.id)) dharByEmployee.set(employee.id, []);
        dharByEmployee.get(employee.id).push(prepared);
      }

      for (const [employeeId, rows] of dharByEmployee.entries()) {
        const issueRows = rows.map(({ received_date, remarks, ...issue }) => issue);
        const issued = await bulkIssueDhar(token, employeeId, issueRows, stats);
        await returnDharRows(token, issued, rows, stats);
      }

      console.log(`${period.name}: imported via API.`);
    }
  } finally {
    await reopenPeriods(token, closedForImport);
    await db.destroy();
  }

  console.log(JSON.stringify(stats, null, 2));
}

main().catch(async (err) => {
  console.error(err.message);
  if (err.data) console.error(JSON.stringify(err.data));
  await db.destroy();
  process.exit(1);
});
