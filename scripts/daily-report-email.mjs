/**
 * AKM Music Centre — Daily Report Email
 * Runs via GitHub Actions at 9:30 PM UAE (17:30 UTC).
 * Reads today's Firestore data and sends an HTML email via Resend.
 *
 * Required env vars (set as GitHub Secrets):
 *   FIREBASE_SERVICE_ACCOUNT  — JSON string of Firebase service account key
 *   RESEND_API_KEY            — API key from resend.com (free tier: 100 emails/day)
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore }        from 'firebase-admin/firestore';
import { Resend }              from 'resend';

// ── Firebase Admin init ──────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount), projectId: 'akm-pos-480210' });
const db = getFirestore();

// ── UAE date (UTC+4) ─────────────────────────────────────────────
const uaeDateStr = new Date(Date.now() + 4 * 3600_000)
  .toISOString()
  .slice(0, 10); // "YYYY-MM-DD"

const displayDate = new Date(uaeDateStr + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

console.log(`Generating report for ${uaeDateStr} (${displayDate})…`);

// ── Firestore queries ────────────────────────────────────────────
const [invSnap, depSnap, expSnap] = await Promise.all([
  db.collection('invoices').where('date', '==', uaeDateStr).get(),
  db.collection('deposits').where('date', '==', uaeDateStr).get(),
  db.collection('expenses').where('date', '==', uaeDateStr).get(),
]);

const invoices = invSnap.docs.map(d => d.data());
const deposits = depSnap.docs.map(d => d.data());
const expenses = expSnap.docs.map(d => d.data());

// ── Calculations (mirrors app-firestore.js printDailyReport) ─────
let totalSales = 0, totalVAT = 0, paidCount = 0;
let cash = 0, card = 0, tabby = 0, cheque = 0;

invoices.forEach(inv => {
  if (inv.status === 'Paid' && !inv.deleted && !inv.superseded) {
    totalSales += inv.payment?.grandTotal || 0;
    totalVAT   += inv.payment?.vat        || 0;
    cash       += inv.impacts?.cash       || 0;
    card       += inv.impacts?.card       || 0;
    tabby      += inv.impacts?.tabby      || 0;
    cheque     += inv.impacts?.cheque     || 0;
    paidCount++;
  }
});

const activeDeps      = deposits.filter(d => !d.deleted);
const cashDeps        = activeDeps.filter(d => (d.depositType || 'Cash') === 'Cash');
const chequeDeps      = activeDeps.filter(d => d.depositType === 'Cheque');
const totalCashDeps   = cashDeps.reduce((s, d)   => s + (d.amount || 0), 0);
const totalChequeDeps = chequeDeps.reduce((s, d)  => s + (d.amount || 0), 0);
const activeExp       = expenses.filter(e => !e.deleted);
const totalExpenses   = activeExp.reduce((s, e)   => s + (e.amount || 0), 0);
const cashInHand      = cash - totalCashDeps - totalExpenses;

const fmt = n => `AED ${(+n || 0).toFixed(2)}`;
const row = (label, value, bold = false, color = '#111') =>
  `<tr>
    <td style="padding:6px 12px;color:#555;font-size:13px;">${label}</td>
    <td style="padding:6px 12px;text-align:right;font-weight:${bold ? '800' : '600'};font-size:${bold ? '15' : '13'}px;color:${color};">${value}</td>
  </tr>`;

// ── HTML email ───────────────────────────────────────────────────
const invoiceRows = invoices
  .filter(i => i.status === 'Paid' && !i.deleted && !i.superseded)
  .map(i => `<tr>
    <td style="padding:4px 12px;font-size:12px;color:#0369a1;font-weight:700;">${i.invoiceNumber || ''}</td>
    <td style="padding:4px 12px;font-size:12px;">${i.customer?.name || '—'}</td>
    <td style="padding:4px 12px;font-size:12px;text-align:right;color:#555;">${i.payment?.method || ''}</td>
    <td style="padding:4px 12px;font-size:12px;text-align:right;font-weight:700;">${fmt(i.payment?.grandTotal)}</td>
  </tr>`).join('');

const depRows = activeDeps.map(d => `<tr>
  <td style="padding:4px 12px;font-size:12px;color:#7c3aed;font-weight:700;">${d.depositId || ''}</td>
  <td style="padding:4px 12px;font-size:12px;">${d.depositor || '—'}${d.depositType === 'Cheque' ? ' <span style="background:#ede9fe;color:#7c3aed;padding:1px 5px;border-radius:4px;font-size:10px;">CHQ</span>' : ''}</td>
  <td style="padding:4px 12px;font-size:12px;">${d.bank || ''}</td>
  <td style="padding:4px 12px;font-size:12px;text-align:right;font-weight:700;">${fmt(d.amount)}</td>
</tr>`).join('');

const expRows = activeExp.map(e => `<tr>
  <td style="padding:4px 12px;font-size:12px;">${e.description || '—'}</td>
  <td style="padding:4px 12px;font-size:12px;text-align:right;font-weight:700;color:#dc2626;">${fmt(e.amount)}</td>
</tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AKM Daily Report — ${displayDate}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0ea5e9,#0369a1);padding:28px 32px;">
      <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:1px;">AKM MUSIC CENTRE</div>
      <div style="font-size:13px;color:#bae6fd;margin-top:4px;">Daily Report · ${displayDate}</div>
    </div>

    <!-- Sales Summary -->
    <div style="padding:20px 20px 0;">
      <div style="font-size:11px;font-weight:800;color:#0369a1;letter-spacing:2px;text-transform:uppercase;padding:8px 12px;background:#f0f9ff;border-radius:6px;border-left:4px solid #0ea5e9;margin-bottom:4px;">Sales Summary</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${row('Total Sales (incl. VAT)', fmt(totalSales))}
        ${row('VAT 5%', fmt(totalVAT))}
        ${row('Net Sales (excl. VAT)', fmt(totalSales - totalVAT))}
        ${row('Paid Invoices', paidCount, false, '#0369a1')}
      </table>
    </div>

    <!-- Payment Breakdown -->
    <div style="padding:16px 20px 0;">
      <div style="font-size:11px;font-weight:800;color:#0369a1;letter-spacing:2px;text-transform:uppercase;padding:8px 12px;background:#f0f9ff;border-radius:6px;border-left:4px solid #0ea5e9;margin-bottom:4px;">Payment Breakdown</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${cash   > 0 ? row('Cash',   fmt(cash))   : ''}
        ${card   > 0 ? row('Card',   fmt(card))   : ''}
        ${tabby  > 0 ? row('Tabby',  fmt(tabby))  : ''}
        ${cheque > 0 ? row('Cheque', fmt(cheque)) : ''}
        ${row('Total', fmt(totalSales), true, '#059669')}
      </table>
    </div>

    <!-- Cash Flow -->
    <div style="padding:16px 20px 0;">
      <div style="font-size:11px;font-weight:800;color:#0369a1;letter-spacing:2px;text-transform:uppercase;padding:8px 12px;background:#f0f9ff;border-radius:6px;border-left:4px solid #0ea5e9;margin-bottom:4px;">Cash Flow</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${row('Cash Sales',           fmt(cash))}
        ${row('− Cash Deposits',      fmt(totalCashDeps))}
        ${row('− Expenses',           fmt(totalExpenses))}
      </table>
      <div style="margin:8px 0;border-top:2px solid #e2e8f0;"></div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:8px 12px;font-weight:900;font-size:15px;">Cash in Hand</td>
          <td style="padding:8px 12px;text-align:right;font-weight:900;font-size:18px;color:${cashInHand >= 0 ? '#059669' : '#dc2626'};">${fmt(cashInHand)}</td>
        </tr>
      </table>
      ${totalChequeDeps > 0 ? `<div style="padding:4px 12px;font-size:11px;color:#7c3aed;">Cheque deposits (not deducted from cash): ${fmt(totalChequeDeps)}</div>` : ''}
    </div>

    <!-- Invoice List -->
    ${paidCount > 0 ? `
    <div style="padding:16px 20px 0;">
      <div style="font-size:11px;font-weight:800;color:#0369a1;letter-spacing:2px;text-transform:uppercase;padding:8px 12px;background:#f0f9ff;border-radius:6px;border-left:4px solid #0ea5e9;margin-bottom:4px;">Invoices (${paidCount})</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">#</th>
            <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Customer</th>
            <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Method</th>
            <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Amount</th>
          </tr>
        </thead>
        <tbody>${invoiceRows}</tbody>
      </table>
    </div>` : ''}

    <!-- Deposits -->
    ${activeDeps.length > 0 ? `
    <div style="padding:16px 20px 0;">
      <div style="font-size:11px;font-weight:800;color:#7c3aed;letter-spacing:2px;text-transform:uppercase;padding:8px 12px;background:#faf5ff;border-radius:6px;border-left:4px solid #7c3aed;margin-bottom:4px;">Bank Deposits (${activeDeps.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">ID</th>
            <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Depositor</th>
            <th style="padding:6px 12px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Bank</th>
            <th style="padding:6px 12px;text-align:right;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;">Amount</th>
          </tr>
        </thead>
        <tbody>${depRows}</tbody>
      </table>
    </div>` : ''}

    <!-- Expenses -->
    ${activeExp.length > 0 ? `
    <div style="padding:16px 20px 0;">
      <div style="font-size:11px;font-weight:800;color:#dc2626;letter-spacing:2px;text-transform:uppercase;padding:8px 12px;background:#fff5f5;border-radius:6px;border-left:4px solid #dc2626;margin-bottom:4px;">Expenses (${activeExp.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tbody>${expRows}</tbody>
        <tfoot>
          <tr style="border-top:2px solid #fee2e2;">
            <td style="padding:8px 12px;font-weight:800;">Total Expenses</td>
            <td style="padding:8px 12px;text-align:right;font-weight:800;color:#dc2626;">${fmt(totalExpenses)}</td>
          </tr>
        </tfoot>
      </table>
    </div>` : ''}

    <!-- Footer -->
    <div style="padding:24px 20px;margin-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:11px;">
      AKM Music Centre LLC · TRN 100050547700003<br>
      This report was generated automatically at 9:30 PM UAE.
    </div>
  </div>
</body>
</html>`;

// ── Send email ───────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from:    'AKM POS <noreply@akm-music.com>',
  to:      'sales@akm-music.com',
  subject: `AKM Daily Report — ${displayDate} | Sales: ${fmt(totalSales)} | Cash: ${fmt(cashInHand)}`,
  html,
});

if (error) {
  console.error('❌ Email failed:', error);
  process.exit(1);
}

console.log(`✅ Report emailed (id: ${data.id}) — Sales: ${fmt(totalSales)}, Cash in Hand: ${fmt(cashInHand)}`);
