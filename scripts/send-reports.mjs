/**
 * AKM Music Centre — Unified Report Email Script
 *
 * Runs every night at 9:30 PM UAE via GitHub Actions.
 * Automatically decides which reports to send based on the date:
 *
 *   Every night       → Daily Report
 *   Last day of month → + Monthly Summary
 *   Mar 31, Jun 30,
 *   Sep 30, Dec 31   → + Quarterly VAT Report (UAE FTA format)
 *   Dec 31            → + Annual Corporate Tax Statement
 *
 * Required GitHub Secrets:
 *   FIREBASE_SERVICE_ACCOUNT  — JSON of Firebase Admin service account key
 *   RESEND_API_KEY            — API key from resend.com
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore }        from 'firebase-admin/firestore';
import { Resend }              from 'resend';

// ── Init ─────────────────────────────────────────────────────────
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), projectId: 'akm-pos-480210' });
const db     = getFirestore();
const resend = new Resend(process.env.RESEND_API_KEY);
const TO     = 'sales@akm-music.com';
const FROM   = 'AKM POS <noreply@akm-music.com>';

// ── UAE date helpers ─────────────────────────────────────────────
const uaeNow     = () => new Date(Date.now() + 4 * 3_600_000);
const toStr      = d  => d.toISOString().slice(0, 10);                  // YYYY-MM-DD
const fmtDisplay = d  => new Date(toStr(d) + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });

const today  = uaeNow();
const todayS = toStr(today);
const mon    = today.getUTCMonth() + 1;  // 1-12
const day    = today.getUTCDate();
const year   = today.getUTCFullYear();

// Is today the last day of this month?
function isLastDayOfMonth() {
  const tmp = new Date(Date.UTC(year, mon - 1, day + 1));
  return tmp.getUTCDate() === 1;
}

// Is today end of a UAE VAT quarter?
function isVATQuarterEnd() {
  return (mon === 3 && day === 31) || (mon === 6  && day === 30) ||
         (mon === 9 && day === 30) || (mon === 12 && day === 31);
}

const isYearEnd = mon === 12 && day === 31;

// ── Firestore helpers ────────────────────────────────────────────
const snap = (col, start, end) => start === end
  ? db.collection(col).where('date', '==', start).get()
  : db.collection(col).where('date', '>=', start).where('date', '<=', end).get();

async function fetchAll(start, end) {
  const [iS, dS, eS] = await Promise.all([
    snap('invoices', start, end),
    snap('deposits', start, end),
    snap('expenses', start, end),
  ]);
  return {
    invoices: iS.docs.map(d => d.data()),
    deposits: dS.docs.map(d => d.data()),
    expenses: eS.docs.map(d => d.data()),
  };
}

// ── Calculations ─────────────────────────────────────────────────
function calc({ invoices, deposits, expenses }) {
  let totalSales = 0, totalVAT = 0, paidCount = 0;
  let cash = 0, card = 0, tabby = 0, cheque = 0;
  const paidInv = [];

  invoices.forEach(inv => {
    if (inv.status === 'Paid' && !inv.deleted && !inv.superseded) {
      totalSales += inv.payment?.grandTotal || 0;
      totalVAT   += inv.payment?.vat        || 0;
      cash       += inv.impacts?.cash       || 0;
      card       += inv.impacts?.card       || 0;
      tabby      += inv.impacts?.tabby      || 0;
      cheque     += inv.impacts?.cheque     || 0;
      paidCount++;
      paidInv.push(inv);
    }
  });

  const activeDeps      = deposits.filter(d => !d.deleted);
  const cashDeps        = activeDeps.filter(d => (d.depositType || 'Cash') === 'Cash');
  const chequeDeps      = activeDeps.filter(d => d.depositType === 'Cheque');
  const totalCashDeps   = cashDeps.reduce((s, d)  => s + (d.amount || 0), 0);
  const totalChequeDeps = chequeDeps.reduce((s, d) => s + (d.amount || 0), 0);
  const activeExp       = expenses.filter(e => !e.deleted);
  const totalExpenses   = activeExp.reduce((s, e)  => s + (e.amount || 0), 0);
  const cashInHand      = cash - totalCashDeps - totalExpenses;
  const netSales        = totalSales - totalVAT;

  return {
    totalSales, totalVAT, netSales, paidCount, paidInv,
    cash, card, tabby, cheque,
    cashInHand, totalCashDeps, totalChequeDeps, totalExpenses,
    activeDeps, cashDeps, chequeDeps, activeExp,
  };
}

// ── Email primitives ─────────────────────────────────────────────
const fmt     = n   => `AED ${(+n || 0).toFixed(2)}`;
const pct     = n   => `${(+n || 0).toFixed(1)}%`;

const BLUE  = '#0369a1';
const GREEN = '#059669';
const RED   = '#dc2626';
const PURP  = '#7c3aed';

const section = (title, color, bg, content) => `
<div style="padding:16px 20px 0;">
  <div style="font-size:11px;font-weight:800;color:${color};letter-spacing:2px;text-transform:uppercase;
       padding:8px 12px;background:${bg};border-radius:6px;border-left:4px solid ${color};margin-bottom:4px;">${title}</div>
  ${content}
</div>`;

const tbl = rows => `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;

const tr = (label, value, bold = false, color = '#111', fontSize = bold ? 15 : 13) =>
  `<tr>
    <td style="padding:6px 12px;color:#555;font-size:13px;">${label}</td>
    <td style="padding:6px 12px;text-align:right;font-weight:${bold?800:600};font-size:${fontSize}px;color:${color};">${value}</td>
  </tr>`;

const divider = () => `<div style="margin:8px 20px;border-top:2px solid #e2e8f0;"></div>`;

const header = (title, subtitle, date) => `
<div style="background:linear-gradient(135deg,#0ea5e9,#0369a1);padding:28px 32px;">
  <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:1px;">AKM MUSIC CENTRE</div>
  <div style="font-size:16px;font-weight:700;color:#bae6fd;margin-top:2px;">${title}</div>
  <div style="font-size:13px;color:#7dd3fc;margin-top:4px;">${subtitle} · ${date}</div>
</div>`;

const footer = () => `
<div style="padding:24px 20px;margin-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:11px;">
  AKM Music Centre LLC · TRN 100050547700003 · Tel: 02 621 9929<br>
  P.O. Box 8227, Abu Dhabi, UAE — Automated report, do not reply.
</div>`;

const wrap = content => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:640px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  ${content}
</div></body></html>`;

// ── Shared blocks ────────────────────────────────────────────────
function salesBlock(c) {
  return section('Sales Summary', BLUE, '#f0f9ff', tbl(
    tr('Total Sales (incl. VAT)', fmt(c.totalSales)) +
    tr('VAT Collected (5%)', fmt(c.totalVAT)) +
    tr('Net Sales (excl. VAT)', fmt(c.netSales)) +
    tr('Paid Invoices', c.paidCount, false, BLUE)
  ));
}

function paymentBlock(c) {
  return section('Payment Breakdown', BLUE, '#f0f9ff', tbl(
    (c.cash   > 0 ? tr('Cash',   fmt(c.cash))   : '') +
    (c.card   > 0 ? tr('Card',   fmt(c.card))   : '') +
    (c.tabby  > 0 ? tr('Tabby',  fmt(c.tabby))  : '') +
    (c.cheque > 0 ? tr('Cheque', fmt(c.cheque)) : '') +
    tr('Total', fmt(c.totalSales), true, GREEN)
  ));
}

function cashFlowBlock(c) {
  return section('Cash Flow', GREEN, '#f0fdf4', tbl(
    tr('Cash Sales', fmt(c.cash)) +
    tr('− Cash Deposits to Bank', fmt(c.totalCashDeps)) +
    tr('− Expenses', fmt(c.totalExpenses))
  ) + divider() + tbl(
    `<tr>
      <td style="padding:8px 12px;font-weight:900;font-size:15px;">Cash in Hand</td>
      <td style="padding:8px 12px;text-align:right;font-weight:900;font-size:18px;color:${c.cashInHand>=0?GREEN:RED};">${fmt(c.cashInHand)}</td>
    </tr>`
  ) + (c.totalChequeDeps > 0
    ? `<div style="padding:4px 12px 8px;font-size:11px;color:${PURP};">Cheque deposits (not deducted from cash): ${fmt(c.totalChequeDeps)}</div>`
    : ''));
}

function depositsBlock(c) {
  if (!c.activeDeps.length) return '';
  const rows = c.activeDeps.map(d =>
    `<tr>
      <td style="padding:4px 12px;font-size:12px;color:${PURP};font-weight:700;">${d.depositId||''}</td>
      <td style="padding:4px 12px;font-size:12px;">${d.depositor||'—'}${d.depositType==='Cheque'?' <span style="background:#ede9fe;color:#7c3aed;padding:1px 5px;border-radius:4px;font-size:10px;">CHQ</span>':''}</td>
      <td style="padding:4px 12px;font-size:12px;">${d.bank||''}</td>
      <td style="padding:4px 12px;font-size:12px;text-align:right;font-weight:700;">${fmt(d.amount)}</td>
    </tr>`).join('');
  return section(`Bank Deposits (${c.activeDeps.length})`, PURP, '#faf5ff',
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr style="background:#f8fafc;">
        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">ID</th>
        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Depositor</th>
        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Bank</th>
        <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
}

function expensesBlock(c) {
  if (!c.activeExp.length) return '';
  const rows = c.activeExp.map(e =>
    `<tr>
      <td style="padding:4px 12px;font-size:12px;">${e.description||'—'}</td>
      <td style="padding:4px 12px;font-size:12px;text-align:right;font-weight:700;color:${RED};">${fmt(e.amount)}</td>
    </tr>`).join('');
  return section(`Expenses (${c.activeExp.length})`, RED, '#fff5f5',
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:2px solid #fee2e2;">
        <td style="padding:8px 12px;font-weight:800;">Total</td>
        <td style="padding:8px 12px;text-align:right;font-weight:800;color:${RED};">${fmt(c.totalExpenses)}</td>
      </tfoot></table>`);
}

function invoicesBlock(c, limit = 999) {
  if (!c.paidInv.length) return '';
  const rows = c.paidInv.slice(0, limit).map(i =>
    `<tr>
      <td style="padding:4px 12px;font-size:12px;color:${BLUE};font-weight:700;">${i.invoiceNumber||''}</td>
      <td style="padding:4px 12px;font-size:12px;">${i.customer?.name||'—'}</td>
      <td style="padding:4px 12px;font-size:12px;color:#555;">${i.date||''}</td>
      <td style="padding:4px 12px;font-size:12px;text-align:right;color:#555;">${i.payment?.method||''}</td>
      <td style="padding:4px 12px;font-size:12px;text-align:right;font-weight:700;">${fmt(i.payment?.grandTotal)}</td>
    </tr>`).join('');
  const more = c.paidInv.length > limit
    ? `<tr><td colspan="5" style="padding:6px 12px;font-size:11px;color:#94a3b8;text-align:center;">… and ${c.paidInv.length - limit} more</td></tr>`
    : '';
  return section(`Invoices (${c.paidInv.length})`, BLUE, '#f0f9ff',
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr style="background:#f8fafc;">
        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">#</th>
        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Customer</th>
        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Date</th>
        <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Method</th>
        <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Amount</th>
      </tr></thead>
      <tbody>${rows}${more}</tbody>
    </table>`);
}

// ── REPORT 1: Daily ──────────────────────────────────────────────
async function sendDailyReport() {
  const data = await fetchAll(todayS, todayS);
  const c    = calc(data);

  const html = wrap(
    header('Daily Report', 'AKM Music Centre', fmtDisplay(today)) +
    salesBlock(c) + paymentBlock(c) + cashFlowBlock(c) +
    invoicesBlock(c) + depositsBlock(c) + expensesBlock(c) +
    footer()
  );

  await resend.emails.send({
    from, to: TO,
    subject: `AKM Daily Report — ${fmtDisplay(today)} | Sales: ${fmt(c.totalSales)} | Cash: ${fmt(c.cashInHand)}`,
    html,
  });
  console.log(`✅ Daily report sent — Sales: ${fmt(c.totalSales)}, Cash in Hand: ${fmt(c.cashInHand)}`);
}

// ── REPORT 2: Monthly ────────────────────────────────────────────
async function sendMonthlyReport() {
  const start   = `${year}-${String(mon).padStart(2,'0')}-01`;
  const label   = today.toLocaleDateString('en-GB', { month:'long', year:'numeric', timeZone:'UTC' });
  const data    = await fetchAll(start, todayS);
  const c       = calc(data);
  const avgSale = c.paidCount ? c.totalSales / c.paidCount : 0;

  const html = wrap(
    header('Monthly Report', label, `${start} to ${todayS}`) +
    salesBlock(c) +
    section('Monthly Highlights', BLUE, '#f0f9ff', tbl(
      tr('Average Sale Value', fmt(avgSale)) +
      tr('Total Invoices', c.paidCount, false, BLUE) +
      tr('Total Deposits to Bank', fmt(c.totalCashDeps)) +
      tr('Total Expenses', fmt(c.totalExpenses), false, RED) +
      tr('Net Profit (est.)', fmt(c.netSales - c.totalExpenses), true, GREEN)
    )) +
    paymentBlock(c) + cashFlowBlock(c) +
    depositsBlock(c) + expensesBlock(c) +
    footer()
  );

  await resend.emails.send({
    from: FROM, to: TO,
    subject: `AKM Monthly Report — ${label} | Sales: ${fmt(c.totalSales)} | Net: ${fmt(c.netSales - c.totalExpenses)}`,
    html,
  });
  console.log(`✅ Monthly report sent — ${label}, Sales: ${fmt(c.totalSales)}`);
}

// ── REPORT 3: Quarterly VAT ──────────────────────────────────────
async function sendVATReport() {
  // UAE VAT quarters: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec
  const quarters = [
    { months:[1,2,3],   start:`${year}-01-01`, end:`${year}-03-31`, label:`Q1 ${year} (Jan – Mar)` },
    { months:[4,5,6],   start:`${year}-04-01`, end:`${year}-06-30`, label:`Q2 ${year} (Apr – Jun)` },
    { months:[7,8,9],   start:`${year}-07-01`, end:`${year}-09-30`, label:`Q3 ${year} (Jul – Sep)` },
    { months:[10,11,12],start:`${year}-10-01`, end:`${year}-12-31`, label:`Q4 ${year} (Oct – Dec)` },
  ];
  const q = quarters.find(q => q.months.includes(mon));

  const data = await fetchAll(q.start, q.end);
  const c    = calc(data);

  // UAE VAT return fields (Box 1a, 1b etc.)
  const outputVAT    = c.totalVAT;
  const netSalesExcl = c.netSales;
  // Input VAT: not tracked in this system — shown as 0 with advisory note
  const inputVAT     = 0;
  const netVATDue    = outputVAT - inputVAT;
  const vatRatio     = c.totalSales > 0 ? (outputVAT / c.totalSales) * 100 : 0;

  const html = wrap(
    header('Quarterly VAT Report', `UAE FTA — ${q.label}`, `${q.start} to ${q.end}`) +

    section('VAT Return Summary', '#d97706', '#fffbeb', tbl(
      tr('Standard-rated supplies (5%)', fmt(netSalesExcl)) +
      tr('Output VAT collected', fmt(outputVAT), true, '#d97706') +
      tr('Input VAT (from purchases)', fmt(inputVAT)) +
      tr('Net VAT Payable to FTA', fmt(netVATDue), true, RED) +
      `<tr><td colspan="2" style="padding:6px 12px;font-size:11px;color:#92400e;background:#fef3c7;">
        ⚠ Input VAT from supplier invoices is not tracked in this POS — consult your accountant to include
        deductible input VAT before filing. The payable shown is worst-case (output only).
      </td></tr>`
    )) +

    section('Period Sales Detail', BLUE, '#f0f9ff', tbl(
      tr('Total Invoiced (incl. VAT)',  fmt(c.totalSales)) +
      tr('VAT Component (5%)',          fmt(c.totalVAT)) +
      tr('Net Revenue (excl. VAT)',     fmt(c.netSales)) +
      tr('VAT as % of gross sales',    pct(vatRatio)) +
      tr('Total Paid Invoices',         c.paidCount)
    )) +

    paymentBlock(c) + expensesBlock(c) +

    section('Filing Reminder', '#d97706', '#fffbeb',
      `<div style="padding:8px 12px;font-size:13px;color:#78350f;">
        <strong>UAE VAT Return for ${q.label}</strong><br>
        Filing deadline: <strong>28 days after quarter end</strong><br>
        TRN: 100050547700003<br>
        Submit at: <a href="https://eservices.tax.gov.ae" style="color:#d97706;">eservices.tax.gov.ae</a>
      </div>`
    ) +
    footer()
  );

  await resend.emails.send({
    from: FROM, to: TO,
    subject: `AKM VAT Report — ${q.label} | Output VAT: ${fmt(outputVAT)} | Net Due: ${fmt(netVATDue)}`,
    html,
  });
  console.log(`✅ VAT report sent — ${q.label}, VAT due: ${fmt(netVATDue)}`);
}

// ── REPORT 4: Annual Corporate Tax ──────────────────────────────
async function sendAnnualReport() {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;
  const data  = await fetchAll(start, end);
  const c     = calc(data);

  // UAE Corporate Tax (effective June 2023)
  const CT_THRESHOLD    = 375_000;   // AED — 0% below this
  const CT_RATE         = 0.09;      // 9% above threshold
  const SBR_THRESHOLD   = 3_000_000; // AED — Small Business Relief eligibility
  const taxableProfit   = Math.max(0, c.netSales - c.totalExpenses);
  const corporateTax    = taxableProfit > CT_THRESHOLD
    ? (taxableProfit - CT_THRESHOLD) * CT_RATE : 0;
  const sbrEligible     = c.totalSales < SBR_THRESHOLD;
  const effectiveTaxRate = taxableProfit > 0 ? (corporateTax / taxableProfit) * 100 : 0;

  // Monthly breakdown for chart-like display
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthlyData = await Promise.all(months.map(async (m, i) => {
    const mm  = String(i+1).padStart(2,'0');
    const last = new Date(Date.UTC(year, i+1, 0)).getUTCDate();
    const mData = await fetchAll(`${year}-${mm}-01`, `${year}-${mm}-${last}`);
    const mCalc = calc(mData);
    return { m, sales: mCalc.totalSales, net: mCalc.netSales };
  }));

  const monthlyRows = monthlyData.map(({ m, sales, net }) =>
    `<tr>
      <td style="padding:4px 12px;font-size:12px;font-weight:700;color:#64748b;">${m}</td>
      <td style="padding:4px 12px;font-size:12px;text-align:right;">${fmt(sales)}</td>
      <td style="padding:4px 12px;font-size:12px;text-align:right;color:${GREEN};">${fmt(net)}</td>
    </tr>`).join('');

  const html = wrap(
    header('Annual Statement', `Financial Year ${year}`, `${start} to ${end}`) +

    section('Annual Financial Summary', BLUE, '#f0f9ff', tbl(
      tr('Total Revenue (incl. VAT)',  fmt(c.totalSales)) +
      tr('Total VAT Collected',        fmt(c.totalVAT)) +
      tr('Net Revenue (excl. VAT)',    fmt(c.netSales)) +
      tr('Total Expenses',             fmt(c.totalExpenses), false, RED) +
      tr('Net Profit (est.)',          fmt(taxableProfit), true, taxableProfit>=0?GREEN:RED) +
      tr('Total Paid Invoices',        c.paidCount) +
      tr('Total Bank Deposits',        fmt(c.totalCashDeps))
    )) +

    section('UAE Corporate Tax Estimate', RED, '#fff5f5', tbl(
      tr('Taxable Profit',             fmt(taxableProfit)) +
      tr('0% Threshold',               fmt(CT_THRESHOLD)) +
      tr('Taxable above threshold',    fmt(Math.max(0, taxableProfit - CT_THRESHOLD))) +
      tr('Corporate Tax @ 9%',         fmt(corporateTax), true, corporateTax > 0 ? RED : GREEN) +
      tr('Effective Tax Rate',         pct(effectiveTaxRate)) +
      `<tr><td colspan="2" style="padding:8px 12px;font-size:12px;background:${sbrEligible?'#f0fdf4':'#fff5f5'};color:${sbrEligible?'#166534':'#991b1b'};">
        ${sbrEligible
          ? `✅ Small Business Relief may apply (revenue AED ${(c.totalSales/1000).toFixed(0)}k < AED 3M limit) — confirm eligibility with your tax agent.`
          : `⚠ Revenue exceeds AED 3M — Small Business Relief not available. Consult your UAE CT registered agent.`
        }
      </td></tr>` +
      `<tr><td colspan="2" style="padding:6px 12px;font-size:11px;color:#92400e;background:#fef3c7;">
        ⚠ This is an estimate based on POS data. Consult your UAE Corporate Tax registered agent for the
        official return. Input VAT, depreciation, and other deductions are not included.
      </td></tr>`
    )) +

    section('Monthly Breakdown', BLUE, '#f0f9ff',
      `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Month</th>
          <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Gross Sales</th>
          <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Net (excl.VAT)</th>
        </tr></thead>
        <tbody>${monthlyRows}</tbody>
        <tfoot><tr style="border-top:2px solid #e2e8f0;">
          <td style="padding:8px 12px;font-weight:800;">TOTAL</td>
          <td style="padding:8px 12px;text-align:right;font-weight:800;">${fmt(c.totalSales)}</td>
          <td style="padding:8px 12px;text-align:right;font-weight:800;color:${GREEN};">${fmt(c.netSales)}</td>
        </tr></tfoot>
      </table>`
    ) +

    paymentBlock(c) + expensesBlock(c) +

    section('Tax Filing Reminder', '#d97706', '#fffbeb',
      `<div style="padding:8px 12px;font-size:13px;color:#78350f;">
        <strong>UAE Corporate Tax FY ${year}</strong><br>
        Tax return deadline: typically <strong>9 months after FY end</strong> (i.e., September ${year+1})<br>
        Registration: <a href="https://eservices.tax.gov.ae" style="color:#d97706;">eservices.tax.gov.ae</a><br>
        TRN: 100050547700003
      </div>`
    ) +
    footer()
  );

  await resend.emails.send({
    from: FROM, to: TO,
    subject: `AKM Annual Statement FY${year} | Revenue: ${fmt(c.totalSales)} | Profit: ${fmt(taxableProfit)} | CT Est: ${fmt(corporateTax)}`,
    html,
  });
  console.log(`✅ Annual report sent — FY${year}, Revenue: ${fmt(c.totalSales)}, CT estimate: ${fmt(corporateTax)}`);
}

// ── Main ─────────────────────────────────────────────────────────
console.log(`📅 UAE date: ${todayS} | lastDayOfMonth: ${isLastDayOfMonth()} | vatQEnd: ${isVATQuarterEnd()} | yearEnd: ${isYearEnd}`);

// Always send daily
await sendDailyReport();

// Monthly — last day of month
if (isLastDayOfMonth()) await sendMonthlyReport();

// VAT — end of each quarter
if (isVATQuarterEnd()) await sendVATReport();

// Annual Corporate Tax — December 31 only
if (isYearEnd) await sendAnnualReport();

console.log('✅ All reports done.');
