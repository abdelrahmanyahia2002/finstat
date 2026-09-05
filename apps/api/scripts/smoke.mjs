/**
 * End to end smoke test.
 *
 * Drives the running API the way the web app does: sign in, read the seeded
 * company, check the statements balance, paste a trial balance, run the
 * validation, carry a year forward, and pull a PDF and an Excel pack out the
 * other side. Every figure it asserts is one an accountant would check.
 *
 *   node scripts/smoke.mjs [http://localhost:4000]
 */

const BASE = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@finstat.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';

let accessToken = '';
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  let body;
  if (contentType.includes('application/json')) body = await response.json();
  else if (contentType.includes('text/')) body = await response.text();
  else body = Buffer.from(await response.arrayBuffer());

  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

async function waitForJob(companyId, jobId, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { body } = await api(`/companies/${companyId}/jobs/${jobId}`);
    if (body.status === 'COMPLETED' || body.status === 'FAILED') return body;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { status: 'TIMEOUT', error: `Job did not finish within ${timeoutMs}ms` };
}

async function main() {
  section('Health');
  const health = await api('/health');
  check('health endpoint answers', health.ok && health.body.status === 'ok', JSON.stringify(health.body));

  section('Authentication');
  const anonymous = await api('/companies');
  check('an unauthenticated request is refused', anonymous.status === 401, `got ${anonymous.status}`);

  const badLogin = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'not-the-password' }),
  });
  check('a wrong password is refused', badLogin.status === 401, `got ${badLogin.status}`);

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check('sign in succeeds', login.ok && Boolean(login.body.accessToken), JSON.stringify(login.body));
  accessToken = login.body.accessToken;

  const me = await api('/auth/me');
  check('the session identifies the user', me.ok && me.body.email === EMAIL);

  section('Companies and years');
  const companies = await api('/companies');
  check('the demo company is listed', companies.ok && companies.body.length >= 1);
  const company = companies.body.find((c) => c.name === 'Northwind Trading Ltd');
  check('Northwind Trading Ltd is present', Boolean(company));
  const companyId = company.id;

  const years = await api(`/companies/${companyId}/years`);
  check('two financial years exist', years.ok && years.body.length === 2, `got ${years.body.length}`);
  const fy2025 = years.body.find((y) => y.label === 'FY2025');
  const fy2024 = years.body.find((y) => y.label === 'FY2024');
  check('FY2025 is the current year', fy2025?.isCurrent === true);
  check('FY2025 has FY2024 as its comparative', fy2025?.previousYearLabel === 'FY2024');
  check('both years balance', fy2024?.isBalanced === true && fy2025?.isBalanced === true);

  section('Trial balance');
  const tb = await api(`/companies/${companyId}/years/${fy2025.id}/trial-balance`);
  check('the trial balance loads', tb.ok);
  check(
    'debits equal credits',
    tb.body.isBalanced && tb.body.difference === 0,
    `debits ${tb.body.totalDebit}, credits ${tb.body.totalCredit}`,
  );
  check('prior year figures come through', tb.body.rows.some((r) => r.priorDebit > 0 || r.priorCredit > 0));
  const bank = tb.body.rows.find((r) => r.code === '1500');
  check('the bank balance is 140,000', bank?.debit === 140000, `got ${bank?.debit}`);

  section('Statements');
  const statements = await api(`/companies/${companyId}/years/${fy2025.id}/statements`);
  check('the statements build', statements.ok);

  const bs = statements.body.current.balanceSheet;
  check('total assets are 1,010,000', bs.totalAssets === 1010000, `got ${bs.totalAssets}`);
  check(
    'the balance sheet balances',
    bs.balanceDifference === 0,
    `assets ${bs.totalAssets} against equity and liabilities ${bs.totalEquityAndLiabilities}`,
  );
  check('retained earnings are 500,000', bs.retainedEarnings === 500000, `got ${bs.retainedEarnings}`);

  const pl = statements.body.current.income;
  check('gross profit is 430,000', pl.grossProfit === 430000, `got ${pl.grossProfit}`);
  check('profit for the year is 120,000', pl.profitForYear === 120000, `got ${pl.profitForYear}`);
  check('the comparative year is included', statements.body.prior?.label === 'FY2024');
  check(
    "last year's profit is 84,000",
    statements.body.prior?.income.profitForYear === 84000,
    `got ${statements.body.prior?.income.profitForYear}`,
  );

  const cf = statements.body.cashFlow;
  check('a cash flow statement is produced', Boolean(cf));
  check(
    'the cash flow reconciles to the movement in cash',
    cf?.totals.reconciliationDifference === 0,
    `out by ${cf?.totals.reconciliationDifference}`,
  );
  check('the net movement is 50,000', cf?.totals.netMovement === 50000, `got ${cf?.totals.netMovement}`);
  check('closing cash is 140,000', cf?.totals.closingCash === 140000, `got ${cf?.totals.closingCash}`);

  section('Validation');
  const validation = await api(`/companies/${companyId}/years/${fy2025.id}/validation`);
  check('the validation run completes', validation.ok);
  check(
    'the seeded company passes every check',
    validation.body.passed && validation.body.errorCount === 0,
    JSON.stringify(validation.body.issues.filter((i) => i.severity === 'ERROR')),
  );

  section('Debtors and creditors');
  const debtors = await api(`/companies/${companyId}/years/${fy2025.id}/subledger?type=DEBTOR`);
  check('the debtors listing loads', debtors.ok);
  check('debtors total 210,000', debtors.body.totals.total === 210000, `got ${debtors.body.totals.total}`);
  check(
    'debtors agree to the control account',
    debtors.body.agrees,
    `control ${debtors.body.controlAccountTotal}, listing ${debtors.body.totals.total}`,
  );

  const creditors = await api(`/companies/${companyId}/years/${fy2025.id}/subledger?type=CREDITOR`);
  check('creditors agree to the control account', creditors.body.agrees);

  const badType = await api(`/companies/${companyId}/years/${fy2025.id}/subledger?type=NONSENSE`);
  check('an unknown listing type is refused', badType.status === 400, `got ${badType.status}`);

  section('Notes');
  const generated = await api(`/companies/${companyId}/years/${fy2025.id}/notes/generate`, {
    method: 'POST',
    body: JSON.stringify({ includePolicies: true }),
  });
  check('notes generate', generated.ok, JSON.stringify(generated.body));

  const notes = await api(`/companies/${companyId}/years/${fy2025.id}/notes`);
  check('notes are returned', notes.ok && notes.body.length > 4, `got ${notes.body.length}`);
  check('every note ties to the statements', notes.body.every((n) => n.ties));
  const numbers = notes.body.map((n) => n.number);
  check('note numbers are unique', new Set(numbers).size === numbers.length);

  section('Access control');
  const otherCompany = await api('/companies/00000000-0000-0000-0000-000000000000/years');
  check('a company you are not on is not found', otherCompany.status === 404, `got ${otherCompany.status}`);

  const crossYear = await api(`/companies/${companyId}/years/${fy2024.id}/trial-balance`);
  check('a year of the same company is reachable', crossYear.ok);

  const lockedWrite = await api(`/companies/${companyId}/years/${fy2024.id}/trial-balance`, {
    method: 'PUT',
    body: JSON.stringify({ entries: [] }),
  });
  check('a closed year refuses writes', lockedWrite.status === 403, `got ${lockedWrite.status}`);

  section('Paste');
  const pasteText = [
    'Code\tAccount name\tDebit\tCredit',
    '1520\tPetty cash\t500.00\t',
    '2780\tAccrued expenses\t\t500.00',
  ].join('\r\n');

  const preview = await api(`/companies/${companyId}/years/${fy2025.id}/trial-balance/paste/preview`, {
    method: 'POST',
    body: JSON.stringify({ text: pasteText }),
  });
  check('a paste preview reads both rows', preview.ok && preview.body.rows.length === 2);
  check('the preview finds no errors', preview.body.errorCount === 0, JSON.stringify(preview.body.rows));
  check('the preview balances', preview.body.difference === 0);

  const committed = await api(`/companies/${companyId}/years/${fy2025.id}/trial-balance/paste`, {
    method: 'POST',
    body: JSON.stringify({ text: pasteText }),
  });
  check('the paste applies', committed.ok, JSON.stringify(committed.body).slice(0, 300));
  check(
    'the trial balance still balances after pasting',
    committed.body?.result?.isBalanced === true,
    `difference ${committed.body?.result?.difference}`,
  );

  const pastedRow = committed.body.result.rows.find((r) => r.code === '1520');
  check('the pasted figure landed', pastedRow?.debit === 500, `got ${pastedRow?.debit}`);

  // Put the company back the way the seed left it.
  await api(`/companies/${companyId}/years/${fy2025.id}/trial-balance`, {
    method: 'PUT',
    body: JSON.stringify({
      entries: [
        { accountId: pastedRow.accountId, debit: 0, credit: 0 },
        {
          accountId: committed.body.result.rows.find((r) => r.code === '2780').accountId,
          debit: 0,
          credit: 0,
        },
      ],
    }),
  });

  const unknownAccount = await api(`/companies/${companyId}/years/${fy2025.id}/trial-balance/paste`, {
    method: 'POST',
    body: JSON.stringify({ text: '9911\tMystery account\t100\t' }),
  });
  check(
    'pasting an unknown account is refused rather than guessed at',
    unknownAccount.status === 400,
    `got ${unknownAccount.status}`,
  );

  section('Reports');
  const pdfJob = await api(`/companies/${companyId}/years/${fy2025.id}/reports/pdf`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'FULL_ANNUAL_FINANCIAL_STATEMENTS' }),
  });
  check('a PDF job is queued', pdfJob.ok && pdfJob.body.status === 'QUEUED', JSON.stringify(pdfJob.body));

  const finishedPdf = await waitForJob(companyId, pdfJob.body.id);
  check('the PDF job completes', finishedPdf.status === 'COMPLETED', finishedPdf.error ?? finishedPdf.status);

  if (finishedPdf.status === 'COMPLETED') {
    const download = await api(`/companies/${companyId}/jobs/${pdfJob.body.id}/download`);
    const isPdf = Buffer.isBuffer(download.body) && download.body.subarray(0, 5).toString() === '%PDF-';
    check('the download is a real PDF', isPdf, `${download.body?.length ?? 0} bytes`);

    // Page objects stay readable even though the content streams are
    // compressed, so counting them proves the whole pack rendered rather than
    // just the cover.
    const pageCount = (download.body?.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    check(
      'the pack runs to a cover, three statements and the notes',
      pageCount >= 5,
      `${pageCount} pages, ${download.body?.length} bytes`,
    );
  }

  const excelJob = await api(`/companies/${companyId}/years/${fy2025.id}/excel/export`, {
    method: 'POST',
    body: JSON.stringify({ variant: 'STATEMENTS' }),
  });
  check('an Excel job is queued', excelJob.ok);

  const finishedExcel = await waitForJob(companyId, excelJob.body.id);
  check('the Excel job completes', finishedExcel.status === 'COMPLETED', finishedExcel.error ?? finishedExcel.status);

  let workbookBuffer = null;
  if (finishedExcel.status === 'COMPLETED') {
    const download = await api(`/companies/${companyId}/jobs/${excelJob.body.id}/download`);
    workbookBuffer = download.body;
    // Every xlsx is a zip, and every zip starts PK.
    const isXlsx = Buffer.isBuffer(workbookBuffer) && workbookBuffer.subarray(0, 2).toString() === 'PK';
    check('the download is a real workbook', isXlsx, `${workbookBuffer?.length ?? 0} bytes`);
  }

  section('Excel round trip');
  if (workbookBuffer) {
    const form = new FormData();
    form.append('file', new Blob([workbookBuffer]), 'statements.xlsx');
    form.append('sheetName', 'Trial balance');

    const importPreview = await fetch(
      `${BASE}/api/companies/${companyId}/years/${fy2025.id}/excel/preview`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form },
    ).then((r) => r.json());

    check(
      'the exported workbook reads back in',
      Array.isArray(importPreview.rows) && importPreview.rows.length > 0,
      JSON.stringify(importPreview).slice(0, 300),
    );
    check(
      'reading it back finds no errors',
      importPreview.errorCount === 0,
      JSON.stringify(importPreview.rows?.filter((r) => r.action === 'ERROR')).slice(0, 300),
    );
    check(
      'the round trip still balances',
      importPreview.difference === 0,
      `out by ${importPreview.difference}`,
    );
  }

  section('Carry forward');
  const existingFy2026 = years.body.find((y) => y.label === 'FY2026');
  if (existingFy2026) {
    await api(`/companies/${companyId}/years/${existingFy2026.id}`, { method: 'DELETE' });
  }

  const carried = await api(`/companies/${companyId}/years/${fy2025.id}/carry-forward`, {
    method: 'POST',
    body: JSON.stringify({
      label: 'FY2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      closeSourceYear: false,
      copyNotes: true,
    }),
  });
  check('the year carries forward', carried.ok, JSON.stringify(carried.body).slice(0, 300));

  if (carried.ok) {
    const newYearId = carried.body.year.id;
    const opening = await api(`/companies/${companyId}/years/${newYearId}/statements`);

    check('the new year balances', opening.body.current.balanceSheet.balanceDifference === 0);
    check(
      'opening retained earnings equal last year closing',
      opening.body.current.sections.RETAINED_EARNINGS.amount === 500000,
      `got ${opening.body.current.sections.RETAINED_EARNINGS.amount}`,
    );
    check(
      'the profit and loss opens at nil',
      opening.body.current.income.revenue === 0 && opening.body.current.income.profitForYear === 0,
      `revenue ${opening.body.current.income.revenue}`,
    );
    check(
      'dividends reset for the new year',
      opening.body.current.sections.DIVIDENDS_DECLARED.amount === 0,
      `got ${opening.body.current.sections.DIVIDENDS_DECLARED.amount}`,
    );
    check(
      'total assets carry across unchanged',
      opening.body.current.balanceSheet.totalAssets === 1010000,
      `got ${opening.body.current.balanceSheet.totalAssets}`,
    );
    check(
      'the carried forward year raises no validation errors',
      opening.body.validation.errorCount === 0,
      JSON.stringify(opening.body.validation.issues.filter((i) => i.severity === 'ERROR')).slice(0, 400),
    );

    const carriedNotes = await api(`/companies/${companyId}/years/${newYearId}/notes`);
    check('accounting policies came across', carriedNotes.body.length >= 4, `got ${carriedNotes.body.length}`);

    const again = await api(`/companies/${companyId}/years/${fy2025.id}/carry-forward`, {
      method: 'POST',
      body: JSON.stringify({ label: 'FY2026b', startDate: '2026-01-01', endDate: '2026-12-31' }),
    });
    check('a year cannot be carried forward twice', again.status === 409, `got ${again.status}`);

    await api(`/companies/${companyId}/years/${newYearId}`, { method: 'DELETE' });

    // Deleting the year that carry forward made current should hand that back
    // to the most recent year left, so a second run of this test starts from
    // the same place as the first.
    const afterDelete = await api(`/companies/${companyId}/years`);
    check(
      'deleting the current year promotes the one before it',
      afterDelete.body.find((y) => y.label === 'FY2025')?.isCurrent === true,
      JSON.stringify(afterDelete.body.map((y) => [y.label, y.isCurrent])),
    );
  }

  section('Settings and audit');
  const settings = await api(`/companies/${companyId}/settings`);
  check('settings load', settings.ok && settings.body.currencyCode === 'USD');

  const updated = await api(`/companies/${companyId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ negativeStyle: 'MINUS', decimals: 2 }),
  });
  check('settings save', updated.ok && updated.body.negativeStyle === 'MINUS');
  await api(`/companies/${companyId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ negativeStyle: 'PARENTHESES' }),
  });

  const audit = await api(`/companies/${companyId}/audit?pageSize=10`);
  check('the audit trail records what happened', audit.ok && audit.body.items.length > 0);

  section('Input handling');
  const rejected = await api('/companies', {
    method: 'POST',
    body: JSON.stringify({ name: 'X', unexpectedField: true }),
  });
  check('unknown fields are rejected', rejected.status === 400, `got ${rejected.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('\nThe smoke test could not finish:', error);
  process.exitCode = 1;
});
