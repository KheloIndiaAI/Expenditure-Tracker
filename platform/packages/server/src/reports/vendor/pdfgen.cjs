'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/* Visual palette matching the target PDF */
const COLORS = {
  bluePill: '#2563EB',
  purplePill: '#4F46E5',
  green: '#16A34A',
  red: '#DC2626',
  orange: '#EA580C',
  amberBg: '#FEF3C7',
  amberFg: '#92400E',
  greenBg: '#DCFCE7',
  greenFg: '#15803D',
  cardBg: '#FFFFFF',
  cardBorder: '#E2E8F0',
  capBg: '#EEF2FC',
  headBg: '#F8FAFC',
  subText: '#64748B',
  darkText: '#0F172A',
  dots: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#4A3AA7', '#E34948', '#008300'],
};

/* VENDOR PATCH 3 of 6 — see reports/vendor/README.md.
   Upstream looks for Edge or Chrome at the four places they install on Windows,
   because that is where this ran. On the server it runs on Debian, where the
   browser is at a different path entirely and the Windows list finds nothing —
   which upstream handles by returning null and skipping the PDF, so the failure
   would have been a quietly missing file rather than an error.
   CHROME_PATH is honoured first so the container states its own answer instead
   of relying on this list keeping pace with Debian. The Windows paths are kept
   ahead of nothing and cost nothing: on Linux they simply do not exist, so the
   same file still works unchanged on the desktop it came from. */
function findBrowser() {
  const fromEnv = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/* The switches upstream passes, plus whatever the host says it needs.
   A container adds --no-sandbox (Chromium refuses to start as root otherwise)
   and --disable-dev-shm-usage (its /dev/shm is 64MB and Chromium will crash
   mid-render on a full page without it). Neither is wanted on a desktop, where
   the sandbox should stay on, so they are supplied by the environment rather
   than compiled in — CHROME_FLAGS unset means byte-identical behaviour. */
function browserArgs(pdfFile, htmlFile) {
  const extra = String(process.env.CHROME_FLAGS || '').trim();
  return [
    '--headless',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--run-all-compositor-stages-before-draw',
    ...(extra ? extra.split(/\s+/) : []),
    `--print-to-pdf=${pdfFile}`,
    htmlFile,
  ];
}

/** Format currency amounts for stat cards and tables */
function formatCr(val) {
  if (val == null) return '—';
  if (val === 0) return '₹0';
  const v = Math.abs(val) / 1e7;
  const sign = val < 0 ? '-' : '';
  return `${sign}₹${v.toFixed(2)} Cr`;
}

/** Format amounts in lakhs for distribution table e.g. "₹ 0.79 Lakhs" */
function formatLakh(val) {
  if (val == null || val === 0) return '—';
  if (Math.abs(val) >= 1e7) {
    return `₹ ${(val / 1e7).toFixed(2)} Cr`;
  }
  const l = (val / 1e5).toFixed(2).replace(/\.?0+$/, '');
  return `₹ ${l} Lakhs`;
}

/**
 * Leaderboard amounts. Crore values carry three decimals here, unlike the two
 * used everywhere else: a week's spend at two decimals put Kolkata and
 * Trivandrum both at "₹1.33 Cr" despite ~₹14,000 between them, which reads as
 * a tie in a table whose whole purpose is the ranking. Sub-crore values stay
 * in lakhs, where two decimals already separate them.
 */
function formatLeaderboard(val) {
  if (val == null || val === 0) return '₹0';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(3)} Cr`;
  return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
}

/** Format unspent amount in Regional Centre table e.g. "₹2.42 Cr" or "₹97.65 L" */
function formatRcUnspent(val) {
  if (val == null || val === 0) return '₹0';
  if (Math.abs(val) >= 1e7) {
    return `₹${(val / 1e7).toFixed(2)} Cr`;
  }
  return `₹${(val / 1e5).toFixed(2)} L`;
}

/*
 * One stylesheet, shared by both documents. The weekly leaderboard PDF is a
 * separate file but has to look like the same publication as the daily
 * summary, so it draws its cards, tables, pills and bars from here rather
 * than carrying a second copy that would drift.
 */
const REPORT_CSS = `
    @page {
      size: A4 landscape;
      margin: 6mm 8mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      -webkit-font-smoothing: antialiased;
    }
    .page-container {
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      page-break-after: always;
      page-break-inside: avoid;
    }
    .page-container:last-child {
      page-break-after: auto;
    }

    /*
     * Page-break protection. A page-break-inside rule on the container alone
     * is only a hint — once the content is taller than the sheet the renderer
     * must break somewhere, and left to itself it cut straight through the
     * SAI-INFRA cards, stranding their sub-captions on the next page. Naming
     * the atomic blocks means a break lands *between* them instead.
     */
    .stat-card,
    .stat-cards-row,
    .infra-wrap,
    .div-header,
    .comp-bar,
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    /* Keep a section heading with the block it introduces. */
    .comp-bar,
    .infra-badge {
      break-after: avoid;
      page-break-after: avoid;
    }

    /*
     * Page 1 sizing. The whole sheet used to be set very small so that a
     * ten-row distribution grid would still fit; now that grid is two rows and
     * the type can breathe. Sizes below are set to fill an A4 landscape page —
     * if content is ever added back, scale these down together rather than
     * letting the page spill onto a third sheet.
     */
    .report-title {
      font-size: 17px;
      font-weight: 700;
      text-decoration: underline;
      margin: 0 0 10px 0;
      color: #0F172A;
    }
    .top-grid {
      display: grid;
      grid-template-columns: 36% 62%;
      column-gap: 2%;
      margin-bottom: 14px;
    }
    .table-bordered {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #CBD5E1;
      font-size: 13px;
    }
    .table-bordered td {
      border: 1px solid #CBD5E1;
      padding: 5px 10px;
      height: 26px;
    }
    .bg-balance {
      background-color: #FDE8E8;
    }
    .red-text {
      color: #DC2626;
    }
    .green-text {
      color: #16A34A;
    }
    .orange-text {
      color: #EA580C;
    }
    .font-bold {
      font-weight: 700;
    }
    .font-medium {
      font-weight: 500;
    }
    .text-right {
      text-align: right;
    }
    /* Amounts must not break across lines — "₹ 57.19 Lakhs" is one token. */
    .nowrap {
      white-space: nowrap;
    }
    .dist-title {
      font-size: 13.5px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    /* KI 1 and KI 2 */
    .ki-row {
      display: grid;
      grid-template-columns: 49% 49%;
      column-gap: 2%;
      margin-bottom: 6px;
    }
    .div-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .div-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .div-badge {
      color: #FFFFFF;
      font-size: 13px;
      font-weight: 800;
      padding: 4px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    .div-title {
      font-size: 15px;
      font-weight: 700;
      line-height: 1.2;
    }
    .div-tagline {
      font-size: 10.5px;
      color: #64748B;
    }
    .div-header-right {
      text-align: right;
    }
    .div-pct {
      font-size: 16.5px;
      font-weight: 800;
      line-height: 1.1;
    }
    .div-util-label {
      font-size: 9.5px;
      color: #64748B;
      text-transform: lowercase;
    }

    /* Stat Cards */
    .stat-cards-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      column-gap: 8px;
      margin-bottom: 10px;
    }
    .stat-card {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      padding: 7px 9px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .card-icon-wrap {
      width: 28px;
      height: 28px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .blue-icon { background: #EFF6FF; }
    .green-icon { background: #ECFDF5; }
    .orange-icon { background: #FFF7ED; }

    .card-body {
      overflow: hidden;
      line-height: 1.2;
    }
    .card-label {
      font-size: 9.5px;
      color: #64748B;
      font-weight: 500;
      white-space: nowrap;
    }
    .card-val {
      font-size: 15px;
      font-weight: 800;
      margin: 1px 0;
    }
    /*
     * Sub-captions wrap rather than truncate. They previously carried
     * white-space:nowrap with an ellipsis, which silently ate the back half of
     * the longer ones — "₹30.61 Cr centres + ₹19.11 Cr DDO KI Direct" is the
     * whole point of that line, so losing its tail to a "…" is worse than
     * letting it run to a second line.
     */
    .card-sub {
      font-size: 8.5px;
      color: #64748B;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    /* Collapsible bar */
    .comp-bar {
      background: #EEF2FC;
      border-radius: 4px;
      padding: 4px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 7px;
    }
    .comp-bar-left {
      font-size: 10.5px;
      font-weight: 700;
      color: #475569;
    }
    .comp-bar-mid {
      font-size: 9px;
      font-weight: 600;
      color: #B45309;
    }
    .comp-bar-badge {
      background: #2563EB;
      color: #FFFFFF;
      font-size: 9.5px;
      font-weight: 700;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Comp Table */
    .comp-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      border: 1px solid #E2E8F0;
    }
    .comp-table th {
      background: #F8FAFC;
      color: #64748B;
      font-size: 9px;
      font-weight: 700;
      padding: 7px 9px;
      border-bottom: 1px solid #E2E8F0;
    }
    /*
     * Row padding is the main lever for filling the page: six component rows
     * per division means every 1px here is 12px of sheet. Adjust this before
     * touching font sizes if the page needs to grow or shrink a little.
     */
    .comp-table td {
      padding: 3.5px 9px;
      border-bottom: 1px solid #F1F5F9;
      vertical-align: middle;
    }
    .comp-name-row {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .dot {
      width: 6.5px;
      height: 6.5px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .comp-name {
      font-weight: 500;
    }
    .section-pill {
      font-size: 7px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
      display: inline-block;
      margin-top: 2px;
    }
    .pill-rec {
      background: #DBEAFE;
      color: #1D4ED8;
    }
    .pill-non-rec {
      background: #EDE9FE;
      color: #6D28D9;
    }
    .total-row td {
      background: #F8FAFC;
      border-top: 1px solid #E2E8F0;
      border-bottom: none;
      padding: 4px 9px;
    }

    /* Arrow Rule */
    .arrow-divider {
      display: flex;
      align-items: center;
      margin: 5px 0;
      color: #2563EB;
      font-size: 11px;
    }
    .arrow-line {
      flex: 1;
      height: 1px;
      background: #2563EB;
      margin: 0 4px;
    }

    /* SAI INFRA */
    .infra-wrap {
      width: 60%;
      margin: 0 auto;
      text-align: center;
    }
    .infra-badge {
      display: inline-block;
      background: #FEF08A;
      color: #0F172A;
      font-size: 13.5px;
      font-weight: 800;
      padding: 4px 16px;
      border-radius: 4px;
      margin-bottom: 9px;
    }

    /* Page 2: Regional Centre Dashboard */
    .p2-title {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 16px 0;
    }
    .rc-top-cards {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      column-gap: 14px;
      margin-bottom: 26px;
    }
    .p2-subhead {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .rc-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }
    .rc-table th {
      background: #F8FAFC;
      color: #64748B;
      font-size: 9.5px;
      font-weight: 700;
      padding: 9px 10px;
      border-bottom: 1px solid #E2E8F0;
      text-align: left;
    }
    /*
     * Twelve centre rows carry this page, so their padding is what makes the
     * table fill the sheet rather than stopping half way down it.
     */
    .rc-table td {
      padding: 11px 10px;
      border-bottom: 1px solid #F1F5F9;
      vertical-align: middle;
    }
    .rc-name-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }
    .util-overview-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pct-pill {
      font-size: 10px;
      font-weight: 800;
      padding: 3px 6px;
      border-radius: 3px;
      width: 40px;
      text-align: center;
      flex-shrink: 0;
    }
    .progress-bar-wrap {
      flex: 1;
      height: 18px;
      border-radius: 9px;
      overflow: hidden;
      display: flex;
      background: #EA580C;
    }
    .bar-used {
      background: #16A34A;
      color: #FFFFFF;
      font-size: 8px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
    }
    .bar-free {
      background: #EA580C;
      color: #FFFFFF;
      font-size: 8px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
    }
    .p2-legend {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      margin-top: 16px;
      font-size: 10.5px;
      color: #64748B;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /*
     * Weekly leaderboard (Monday only). Deliberately built from the Regional
     * Centre page's own parts — .p2-title, .rc-table, .pct-pill, the stat
     * cards — so the two pages read as one document rather than as a bolted-on
     * extra. Only the rank medal and the single-fill bar are new.
     */
    .lb-sub {
      font-size: 11px;
      color: #64748B;
      margin: -10px 0 16px 0;
    }
    .lb-rank {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      background: #F1F5F9;
      color: #64748B;
    }
    .lb-rank-1 { background: #FEF3C7; color: #92400E; }
    .lb-rank-2 { background: #E2E8F0; color: #475569; }
    .lb-rank-3 { background: #FFEDD5; color: #9A3412; }
    /* Single-fill bar: this is a share of one week's spend, so there is no
       "balance" half to show — the track is just empty space. */
    .lb-bar-wrap {
      flex: 1;
      height: 18px;
      border-radius: 9px;
      overflow: hidden;
      display: flex;
      background: #F1F5F9;
    }
    .lb-bar {
      background: #16A34A;
      color: #FFFFFF;
      font-size: 8px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 6px;
      height: 100%;
      min-width: 2px;
    }

    /* Component page: a division tag sits before each component name, so a
       reader can tell KI 1 from KI 2 without cross-referencing page 1. */
    .comp-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .div-tag {
      color: #FFFFFF;
      font-size: 8px;
      font-weight: 800;
      letter-spacing: 0.3px;
      padding: 2px 6px;
      border-radius: 3px;
      flex-shrink: 0;
      min-width: 34px;
      text-align: center;
    }
    .comp-cell-name { font-weight: 700; }

    /* Four KPI cards on the component page rather than three. */
    .cards-4 { grid-template-columns: repeat(4, 1fr); }

    /* The division-split card lists its two figures instead of one headline. */
    .split-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 3px;
    }
    .split-row {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .split-amt {
      font-size: 12.5px;
      font-weight: 800;
      color: #0F172A;
    }

    /*
     * The quiet components collapse into one row: naming them costs four
     * lines, where four separate ranked rows would imply they competed.
     */
    .idle-row td { background: #FCFDFE; }
    .idle-names {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .idle-names .comp-cell-name { font-weight: 500; color: #64748B; }
    .lb-rank-idle { background: #F1F5F9; color: #94A3B8; }
    /*
     * The component page carries eleven rows (eight ranked, the collapsed
     * idle row, header and total) against the Regional Centre page's twelve
     * shorter ones, and its idle row is four lines tall. At the shared
     * padding the total row tipped onto a third sheet, so spacing is tightened
     * here only — the RC pages still fill their own sheets exactly.
     */
    .comp-page .rc-table td { padding: 7px 10px; }
    .comp-page .rc-top-cards { margin-bottom: 18px; }
    .comp-page .p2-title { margin-bottom: 12px; }
    .comp-page .idle-names { gap: 3px; }
    .idle-note {
      font-size: 9.5px;
      font-style: italic;
      color: #94A3B8;
    }
`;

/*
 * The Monday leaderboard page. Returns '' on every other day, which is what
 * keeps this out of the Tuesday-to-Saturday reports entirely rather than
 * rendering an empty page.
 */
function leaderboardPage(lb) {
  if (!lb || !lb.rows || !lb.rows.length) return '';

  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = d => `${D[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${M[d.getMonth()]}`;
  const range = `${dayLabel(lb.start)} – ${dayLabel(lb.end)} ${lb.end.getFullYear()}`;

  const top = lb.rows[0];
  const maxAmount = top.amount || 1;
  const totalClaims = lb.rows.reduce((s, r) => s + r.claims, 0);

  return `
<!-- ==================== WEEKLY LEADERBOARD (Mondays) ==================== -->
<div class="page-container" style="margin-top: 8px;">
  <div class="p2-title">Weekly Leaderboard — Regional Centres</div>
  <div class="lb-sub">Previous week · ${range}</div>

  <div class="rc-top-cards">
    <div class="stat-card" style="padding: 8px 10px;">
      <div class="card-icon-wrap green-icon" style="width: 26px; height: 26px;">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
      </div>
      <div class="card-body">
        <div class="card-label" style="font-size: 8.5px;">Total Spent Last Week</div>
        <div class="card-val green-text" style="font-size: 15px;">${formatLeaderboard(lb.total)}</div>
        <div class="card-sub" style="font-size: 7.5px;">${totalClaims} claims across ${lb.centres} centre${lb.centres === 1 ? '' : 's'}</div>
      </div>
    </div>

    <div class="stat-card" style="padding: 8px 10px;">
      <div class="card-icon-wrap blue-icon" style="width: 26px; height: 26px;">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round"><path d="M4 22h16"/><path d="M2 9l10-7 10 7"/><path d="M6 9v13"/><path d="M10 9v13"/><path d="M14 9v13"/><path d="M18 9v13"/></svg>
      </div>
      <div class="card-body">
        <div class="card-label" style="font-size: 8.5px;">Highest Spending Centre</div>
        <div class="card-val" style="font-size: 15px;">${top.name}</div>
        <div class="card-sub" style="font-size: 7.5px;">${formatLeaderboard(top.amount)} · ${top.share.toFixed(1)}% of the week</div>
      </div>
    </div>

    <div class="stat-card" style="padding: 8px 10px;">
      <div class="card-icon-wrap orange-icon" style="width: 26px; height: 26px;">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#EA580C" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
      </div>
      <div class="card-body">
        <div class="card-label" style="font-size: 8.5px;">Average per Centre</div>
        <div class="card-val orange-text" style="font-size: 15px;">${formatLeaderboard(lb.total / lb.centres)}</div>
        <div class="card-sub" style="font-size: 7.5px;">across centres that claimed last week</div>
      </div>
    </div>
  </div>

  <div class="p2-subhead">Spending by centre</div>

  <table class="rc-table">
    <thead>
      <tr>
        <th style="width: 8%;">Rank</th>
        <th style="width: 24%;">Regional Centre</th>
        <th style="width: 42%;">Share of Week</th>
        <th style="width: 26%; text-align: right;">Total Spent</th>
      </tr>
    </thead>
    <tbody>
      ${lb.rows.map(r => `
          <tr>
            <td><div class="lb-rank ${r.rank <= 3 ? `lb-rank-${r.rank}` : ''}">${r.rank}</div></td>
            <td>
              <div class="rc-name-cell">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round"><path d="M4 22h16"/><path d="M2 9l10-7 10 7"/><path d="M6 9v13"/><path d="M10 9v13"/><path d="M14 9v13"/><path d="M18 9v13"/></svg>
                <span>${r.name}</span>
              </div>
            </td>
            <td>
              <div class="util-overview-cell">
                <div class="pct-pill" style="background: ${COLORS.greenBg}; color: ${COLORS.greenFg};">${r.share.toFixed(1)}%</div>
                <div class="lb-bar-wrap">
                  <div class="lb-bar" style="width: ${Math.max(2, (r.amount / maxAmount) * 100)}%;">${(r.amount / maxAmount) * 100 >= 28 ? formatLeaderboard(r.amount) : ''}</div>
                </div>
              </div>
            </td>
            <td class="text-right font-bold green-text">${formatLeaderboard(r.amount)}</td>
          </tr>
        `).join('')}
      <tr class="total-row">
        <td></td>
        <td class="font-bold">Total</td>
        <td></td>
        <td class="text-right font-bold green-text">${formatLeaderboard(lb.total)}</td>
      </tr>
    </tbody>
  </table>
</div>
`;
}

/*
 * Component-level spend for the week, page 2 of the weekly document.
 *
 * Sheet3 holds running totals with no date column, so these figures are the
 * difference between this Monday's snapshot and the previous one — see
 * src/snapshot.js.
 */
function componentLeaderboardPage(cw) {
  if (!cw || !cw.rows || !cw.rows.length) return '';

  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${String(d).padStart(2, '0')} ${M[m - 1]} ${y}`;
  };

  /* Components are listed under their full names, not the report's short
   * labels — this page is read on its own, away from the summary where the
   * abbreviations are established. The sheet spells the non-recurring pair
   * with a trailing "NR", which is the one abbreviation left in the raw name. */
  const fullName = r => String(r.name).replace(/\s+NR$/i, ' (Non-Recurring)');

  const top = cw.rows[0];
  const maxDelta = top.delta || 1;
  const divColour = d => (d === 'KI-1' ? COLORS.bluePill : d === 'KI-2' ? COLORS.purplePill : COLORS.orange);
  const idle = cw.idleRows || [];

  return `
  <!-- ============== COMPONENT SPEND (week) ============== -->
  <div class="page-container comp-page" style="margin-top: 8px;">
    <div class="p2-title">Component Spending — Last Week</div>
    <div class="lb-sub">Movement between ${label(cw.baselineOn)} and ${label(cw.takenOn)}</div>

    <div class="rc-top-cards cards-4">
      <div class="stat-card" style="padding: 8px 10px;">
        <div class="card-icon-wrap green-icon" style="width: 26px; height: 26px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
        </div>
        <div class="card-body">
          <div class="card-label" style="font-size: 8.5px;">Total Component Spend</div>
          <div class="card-val green-text" style="font-size: 15px;">${formatLeaderboard(cw.total)}</div>
          <div class="card-sub" style="font-size: 7.5px;">${cw.rows.length} of ${cw.considered} components moved</div>
        </div>
      </div>

      <div class="stat-card" style="padding: 8px 10px;">
        <div class="card-icon-wrap blue-icon" style="width: 26px; height: 26px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round"><path d="M12 3 3 8l9 5 9-5z"/><path d="m3 14 9 5 9-5"/></svg>
        </div>
        <div class="card-body">
          <div class="card-label" style="font-size: 8.5px;">Division Split This Week</div>
          <div class="split-list">
            ${cw.byDivision.map(d => `
              <div class="split-row">
                <span class="div-tag" style="background: ${divColour(d.division)};">${d.label}</span>
                <span class="split-amt">${formatLeaderboard(d.total)}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="stat-card" style="padding: 8px 10px;">
        <div class="card-icon-wrap blue-icon" style="width: 26px; height: 26px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
        </div>
        <div class="card-body">
          <div class="card-label" style="font-size: 8.5px;">Fastest Moving Component</div>
          <div class="card-val" style="font-size: 13px;">${fullName(top)}</div>
          <div class="card-sub" style="font-size: 7.5px;">${formatLeaderboard(top.delta)} · ${top.share.toFixed(1)}% of the week</div>
        </div>
      </div>

      <div class="stat-card" style="padding: 8px 10px;">
        <div class="card-icon-wrap orange-icon" style="width: 26px; height: 26px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#EA580C" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        </div>
        <div class="card-body">
          <div class="card-label" style="font-size: 8.5px;">No Movement</div>
          <div class="card-val orange-text" style="font-size: 15px;">${cw.idle}</div>
          <div class="card-sub" style="font-size: 7.5px;">component${cw.idle === 1 ? '' : 's'} unchanged all week</div>
        </div>
      </div>
    </div>

    <div class="p2-subhead">Spending by component</div>

    <table class="rc-table">
      <thead>
        <tr>
          <th style="width: 6%;">Rank</th>
          <th style="width: 38%;">Component</th>
          <th style="width: 24%;">Share of Week</th>
          <th style="width: 16%; text-align: right;">Total to Date</th>
          <th style="width: 16%; text-align: right;">Spent This Week</th>
        </tr>
      </thead>
      <tbody>
        ${cw.rows.map(r => `
            <tr>
              <td><div class="lb-rank ${r.rank <= 3 ? `lb-rank-${r.rank}` : ''}">${r.rank}</div></td>
              <td>
                <div class="comp-cell">
                  <span class="div-tag" style="background: ${divColour(r.division)};">${r.divisionLabel}</span>
                  <span class="comp-cell-name">${fullName(r)}</span>
                </div>
              </td>
              <td>
                <div class="util-overview-cell">
                  <div class="pct-pill" style="background: ${COLORS.greenBg}; color: ${COLORS.greenFg};">${r.share.toFixed(1)}%</div>
                  <div class="lb-bar-wrap">
                    <div class="lb-bar" style="width: ${Math.max(2, (r.delta / maxDelta) * 100)}%;"></div>
                  </div>
                </div>
              </td>
              <td class="text-right" style="color: #64748B;">${formatLeaderboard(r.current)}</td>
              <td class="text-right font-bold green-text">${formatLeaderboard(r.delta)}</td>
            </tr>
          `).join('')}
        ${idle.length ? `
        <tr class="idle-row">
          <td><div class="lb-rank lb-rank-idle">—</div></td>
          <td>
            <div class="idle-names">
              ${idle.map(r => `
                <div class="comp-cell">
                  <span class="div-tag" style="background: ${divColour(r.division)};">${r.divisionLabel}</span>
                  <span class="comp-cell-name">${fullName(r)}</span>
                </div>`).join('')}
            </div>
          </td>
          <td><span class="idle-note">no spend this week</span></td>
          <td></td>
          <td class="text-right font-bold" style="color: #94A3B8;">₹0</td>
        </tr>` : ''}
        <tr class="total-row">
          <td></td>
          <td class="font-bold">Total</td>
          <td></td>
          <td></td>
          <td class="text-right font-bold green-text">${formatLeaderboard(cw.total)}</td>
        </tr>
      </tbody>
    </table>
  </div>
`;
}


/** Generate HTML representation of the exact 2-page report */
function generateReportHtml(data, opts = {}) {
  const asOn = opts.asOn || data.asOn || '03.09.2026';
  const { divisions } = data;
  const ki1 = divisions.find(d => d.key === 'KI-1');
  const ki2 = divisions.find(d => d.key === 'KI-2');
  const infra = divisions.find(d => d.key === 'SAI-INFRA');
  const scheme = divisions.filter(d => !d.source).reduce((s, d) => s + d.assigned, 0);

  const items = (data.day.agencies || []).filter(a => a.amount > 0);

  /*
   * Yesterday's claims, laid out row-wise: the items simply fill left to
   * right, three name/amount pairs per row, and the table ends when they run
   * out. An earlier version sorted them into a fixed column per stream
   * (centres | DDO HQ | everything else) and padded to a minimum of four
   * rows, which left most of the grid blank — any stream with no claims
   * yesterday still cost a full empty column, and a single stream with five
   * claims stretched the table down the page beside them.
   */
  const PAIRS_PER_ROW = 3;
  const label = a => (a.stream === 'DDO_KI' ? 'DDO KI' : a.name);
  const gridRows = [];
  for (let i = 0; i < items.length; i += PAIRS_PER_ROW) {
    const slice = items.slice(i, i + PAIRS_PER_ROW);
    const row = {};
    for (let j = 0; j < PAIRS_PER_ROW; j++) {
      const a = slice[j];
      row[`c${j + 1}Name`] = a ? label(a) : '';
      row[`c${j + 1}Amt`] = a ? formatLakh(a.amount) : '';
    }
    gridRows.push(row);
  }

  // Regional Centres on Page 2
  let rcs = data.regionalCentres || [];
  const order = opts.rcDisplayOrder || [
    'GANDHINAGAR', 'BHOPAL', 'SONEPAT', 'TRIVANDRUM', 'KOLKATA', 'BANGALORE',
    'PATIALA', 'LUCKNOW', 'IMPHAL', 'CHANDIGARH', 'GUWAHATI', 'MUMBAI',
  ];
  if (order && order.length) {
    const rank = new Map(order.map((n, i) => [n.toUpperCase(), i]));
    rcs = [...rcs].sort((a, b) => {
      const ra = rank.has(a.name.toUpperCase()) ? rank.get(a.name.toUpperCase()) : 999;
      const rb = rank.has(b.name.toUpperCase()) ? rank.get(b.name.toUpperCase()) : 999;
      return ra - rb;
    });
  }
  const rcTotals = data.rcTotals || { limitAssigned: 0, actualExp: 0, unspent: 0 };
  const drawn = rcTotals.limitAssigned ? (rcTotals.actualExp / rcTotals.limitAssigned) * 100 : 0;

  function renderDivisionBlock(div, badgeText, badgeColor) {
    if (!div) return '';
    const pctOfScheme = scheme ? (div.assigned / scheme) * 100 : 0;
    const funded = div.fundedCount != null ? div.fundedCount : (div.components || []).length;
    const noSpend = div.noSpendCount || 0;
    const utilPct = div.assigned ? (div.expenditure / div.assigned) * 100 : 0;
    const balPct = div.assigned ? (div.balance / div.assigned) * 100 : 0;

    const comps = div.components || [];

    return `
      <div class="division-block">
        <!-- Division Header -->
        <div class="div-header">
          <div class="div-header-left">
            <span class="div-badge" style="background-color: ${badgeColor};">${badgeText}</span>
            <div class="div-titles">
              <div class="div-title">${div.label === 'KI-1' ? 'Khelo India 1' : 'Khelo India 2'}</div>
              <div class="div-tagline">${div.tagline || ''}</div>
            </div>
          </div>
          <div class="div-header-right">
            <div class="div-pct" style="color: ${badgeColor};">${utilPct.toFixed(1)}%</div>
            <div class="div-util-label">utilised</div>
          </div>
        </div>

        <!-- 3 Stat Cards -->
        <div class="stat-cards-row">
          <div class="stat-card">
            <div class="card-icon-wrap blue-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            </div>
            <div class="card-body">
              <div class="card-label">${div.cardPrefix || div.label} Assignment</div>
              <div class="card-val">${formatCr(div.assigned)}</div>
              <div class="card-sub">${funded} funded components · ${pctOfScheme.toFixed(1)}% of scheme</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="card-icon-wrap green-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            </div>
            <div class="card-body">
              <div class="card-label">${div.cardPrefix || div.label} Expenditure</div>
              <div class="card-val green-text">${formatCr(div.expenditure)}</div>
              <div class="card-sub">${formatCr(div.fromCentres)} centres + ${formatCr(div.fromDirect)} DDO KI Direct</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="card-icon-wrap orange-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#EA580C" stroke-width="2" stroke-linecap="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>
            </div>
            <div class="card-body">
              <div class="card-label">${div.cardPrefix || div.label} Balance</div>
              <div class="card-val orange-text">${formatCr(div.balance)}</div>
              <div class="card-sub">${balPct.toFixed(1)}% still unspent</div>
            </div>
          </div>
        </div>

        <!-- Collapsible Bar -->
        <div class="comp-bar">
          <div class="comp-bar-left">▾ Components of ${div.label === 'KI-1' ? 'KI 1' : 'KI 2'}</div>
          ${noSpend ? `<div class="comp-bar-mid">• ${noSpend} with no spend</div>` : '<div></div>'}
          <div class="comp-bar-badge">${comps.length}</div>
        </div>

        <!-- Table -->
        <table class="comp-table">
          <thead>
            <tr>
              <th style="width: 44%;">COMPONENT</th>
              <th style="width: 18%; text-align: right;">ASSIGNMENT</th>
              <th style="width: 19%; text-align: right;">EXPENDITURE</th>
              <th style="width: 19%; text-align: right;">BALANCE</th>
            </tr>
          </thead>
          <tbody>
            ${comps.map((c, i) => {
              const pillClass = c.section === 'NON-RECURRING' ? 'pill-non-rec' : 'pill-rec';
              const pillLabel = c.section === 'NON-RECURRING' ? 'Non-Recurring' : 'Recurring';
              const dotColor = COLORS.dots[i % COLORS.dots.length];
              const balColor = c.balance != null && c.balance < 0 ? 'red-text' : '';
              return `
                <tr>
                  <td>
                    <div class="comp-name-row">
                      <span class="dot" style="background-color: ${dotColor};"></span>
                      <span class="comp-name">${c.name}</span>
                    </div>
                    <span class="section-pill ${pillClass}">${pillLabel}</span>
                  </td>
                  <td class="text-right font-medium">${c.target != null ? formatCr(c.target) : '—'}</td>
                  <td class="text-right font-medium">${formatCr(c.expenditure)}</td>
                  <td class="text-right font-medium ${balColor}">${c.balance != null ? formatCr(c.balance) : '—'}</td>
                </tr>
              `;
            }).join('')}
            <tr class="total-row">
              <td class="font-bold">${div.label === 'KI-1' ? 'KI 1' : 'KI 2'} total</td>
              <td class="text-right font-bold">${formatCr(div.assigned)}</td>
              <td class="text-right font-bold">${formatCr(div.expenditure)}</td>
              <td class="text-right font-bold red-text">${formatCr(div.balance)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EXPENDITURE SUMMARY (as on ${asOn})</title>
  <style>
${REPORT_CSS}
  </style>
</head>
<body>

  <!-- ==================== PAGE 1 ==================== -->
  <div class="page-container">
    <div class="report-title">EXPENDITURE SUMMARY (as on ${asOn})</div>

    <!-- Top Summary & Yesterday's Distribution Grid -->
    <div class="top-grid">
      <div>
        <table class="table-bordered">
          <tr>
            <td class="font-bold">Total Assigned</td>
            <td class="text-right font-bold">${formatCr(data.totals.assigned)}</td>
          </tr>
          <tr>
            <td class="font-bold">Total Expenditure</td>
            <td class="text-right font-bold">${formatCr(data.totals.expenditure)}</td>
          </tr>
          <tr class="bg-balance">
            <td class="font-bold red-text">BALANCE</td>
            <td class="text-right font-bold red-text">${formatCr(data.totals.balance)}</td>
          </tr>
          <tr>
            <td class="font-bold">Yesterday's Total Expenditure</td>
            <td class="text-right font-bold">${formatCr(data.day.total)}</td>
          </tr>
        </table>
      </div>

      <div>
        <div class="dist-title">Yesterday's Expenditure Distribution &nbsp; ( ${formatCr(data.day.total)} )</div>
        <table class="table-bordered">
          ${gridRows.map(r => `
            <tr>
              <td class="font-bold" style="width: 17%;">${r.c1Name}</td>
              <td class="text-right font-medium nowrap" style="width: 16%; color: ${r.c1Amt && r.c1Amt !== '—' ? '#16A34A' : '#0F172A'};">${r.c1Amt}</td>
              <td class="font-bold" style="width: 17%;">${r.c2Name}</td>
              <td class="text-right font-medium nowrap" style="width: 16%; color: ${r.c2Amt && r.c2Amt !== '—' ? '#16A34A' : '#0F172A'};">${r.c2Amt}</td>
              <td class="font-bold" style="width: 17%;">${r.c3Name}</td>
              <td class="text-right font-medium nowrap" style="width: 17%; color: ${r.c3Amt && r.c3Amt !== '—' ? '#16A34A' : '#0F172A'};">${r.c3Amt}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    </div>

    <!-- KI 1 and KI 2 Side by Side -->
    <div class="ki-row">
      ${renderDivisionBlock(ki1, 'KI 1', '#2563EB')}
      ${renderDivisionBlock(ki2, 'KI 2', '#4F46E5')}
    </div>

    <!-- Arrow divider -->
    <div class="arrow-divider">
      <span>◄</span>
      <div class="arrow-line"></div>
      <span>►</span>
    </div>

    <!-- SAI INFRA -->
    ${infra ? `
      <div class="infra-wrap">
        <div class="infra-badge">SAI – INFRA</div>
        <div class="stat-cards-row">
          <div class="stat-card">
            <div class="card-icon-wrap blue-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            </div>
            <div class="card-body" style="text-align: left;">
              <div class="card-label">INFRA Assignment</div>
              <div class="card-val">${formatCr(infra.assigned)}</div>
              <div class="card-sub">1 funded component · 23.3% of scheme</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="card-icon-wrap green-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            </div>
            <div class="card-body" style="text-align: left;">
              <div class="card-label">INFRA Expenditure</div>
              <div class="card-val green-text">${formatCr(infra.expenditure)}</div>
              <div class="card-sub">${formatCr(infra.fromCentres)} centres + ${formatCr(infra.fromDirect)} DDO KI Direct</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="card-icon-wrap orange-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#EA580C" stroke-width="2" stroke-linecap="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>
            </div>
            <div class="card-body" style="text-align: left;">
              <div class="card-label">INFRA Balance</div>
              <div class="card-val orange-text">${formatCr(infra.balance)}</div>
              <div class="card-sub">35.1% still unspent</div>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  </div>

  <!-- ==================== REGIONAL CENTRE DASHBOARD ==================== -->
  <div class="page-container" style="margin-top: 8px;">
    <div class="p2-title">Regional Centre Dashboard</div>

    <!-- Top 3 Stat Cards -->
    <div class="rc-top-cards">
      <div class="stat-card" style="padding: 8px 10px;">
        <div class="card-icon-wrap blue-icon" style="width: 26px; height: 26px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
        </div>
        <div class="card-body">
          <div class="card-label" style="font-size: 8.5px;">Assignment to Centres</div>
          <div class="card-val" style="font-size: 15px;">${formatCr(rcTotals.limitAssigned)}</div>
          <div class="card-sub" style="font-size: 7.5px;">limit released to centres · not expenditure</div>
        </div>
      </div>

      <div class="stat-card" style="padding: 8px 10px;">
        <div class="card-icon-wrap green-icon" style="width: 26px; height: 26px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
        </div>
        <div class="card-body">
          <div class="card-label" style="font-size: 8.5px;">Actual Expenditure by Centres</div>
          <div class="card-val green-text" style="font-size: 15px;">${formatCr(rcTotals.actualExp)}</div>
          <div class="card-sub" style="font-size: 7.5px;">${drawn.toFixed(1)}% of centre limit drawn · centres only</div>
        </div>
      </div>

      <div class="stat-card" style="padding: 8px 10px;">
        <div class="card-icon-wrap orange-icon" style="width: 26px; height: 26px;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#EA580C" stroke-width="2" stroke-linecap="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>
        </div>
        <div class="card-body">
          <div class="card-label" style="font-size: 8.5px;">Unspent by Centre</div>
          <div class="card-val red-text" style="font-size: 15px;">${formatCr(rcTotals.unspent)}</div>
          <div class="card-sub" style="font-size: 7.5px;">${(100 - drawn).toFixed(1)}% of limit released, not spent</div>
        </div>
      </div>
    </div>

    <div class="p2-subhead">Centre utilisation</div>

    <!-- 12 RC Table -->
    <table class="rc-table">
      <thead>
        <tr>
          <th style="width: 17%;">Regional Centre &nbsp;⇅</th>
          <th style="width: 31%;">Utilisation Overview</th>
          <th style="width: 13%; text-align: right;">Limit Assigned &nbsp;⇅</th>
          <th style="width: 13%; text-align: right;">Actual Exp. &nbsp;⇅</th>
          <th style="width: 13%; text-align: right;">Unspent &nbsp;⇅</th>
          <th style="width: 13%; text-align: right;">Utilisation &nbsp;⇅</th>
        </tr>
      </thead>
      <tbody>
        ${rcs.map(rc => {
          const good = rc.utilisation >= 70;
          const pillBg = good ? COLORS.greenBg : COLORS.amberBg;
          const pillFg = good ? COLORS.greenFg : COLORS.amberFg;
          const usedPct = Math.max(0, Math.min(100, Math.round(rc.utilisation)));
          const freePct = 100 - usedPct;

          return `
            <tr>
              <td>
                <div class="rc-name-cell">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round"><path d="M4 22h16"/><path d="M2 9l10-7 10 7"/><path d="M6 9v13"/><path d="M10 9v13"/><path d="M14 9v13"/><path d="M18 9v13"/></svg>
                  <span>${rc.name}</span>
                </div>
              </td>
              <td>
                <div class="util-overview-cell">
                  <div class="pct-pill" style="background: ${pillBg}; color: ${pillFg};">${rc.utilisation.toFixed(0)}%</div>
                  <div class="progress-bar-wrap">
                    <div class="bar-used" style="width: ${usedPct}%;">${usedPct >= 20 ? `${usedPct}% Used` : ''}</div>
                    <div class="bar-free" style="width: ${freePct}%;">${freePct >= 20 ? `${freePct}% Balance` : ''}</div>
                  </div>
                </div>
              </td>
              <td class="text-right font-bold">${formatCr(rc.limitAssigned)}</td>
              <td class="text-right font-bold green-text">${formatCr(rc.actualExp)}</td>
              <td class="text-right font-bold orange-text">${formatRcUnspent(rc.unspent)}</td>
              <td class="text-right font-bold" style="color: ${pillFg};">${rc.utilisation.toFixed(0)}%</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    <div class="p2-legend">
      <div class="legend-item">
        <span class="dot" style="background: #16A34A;"></span>
        <span>Used (Utilised)</span>
      </div>
      <div class="legend-item">
        <span class="dot" style="background: #EA580C;"></span>
        <span>Balance (Unutilised)</span>
      </div>
      <div>Amounts in ₹ (Indian Rupees)</div>
    </div>
  </div>

</body>
</html>
  `;
}

/** Render HTML and convert to PDF using Microsoft Edge or Chrome */
async function buildPdfAndHtml(data, opts = {}) {
  const html = generateReportHtml(data, opts);
  const outDir = opts.outDir || path.resolve('output');
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = opts.stamp || 'latest';
  const htmlFile = path.join(outDir, `EXPENDITURE SUMMARY - ${stamp}.html`);
  const pdfFile = path.join(outDir, `EXPENDITURE SUMMARY - ${stamp}.pdf`);

  fs.writeFileSync(htmlFile, html, 'utf8');

  /* Server: the PDF is rendered when somebody asks for it, not on every run.
     The HTML above is the exact file it prints from, so rendering later
     reproduces this run byte for byte. Upstream never sets this. */
  if (opts.skipPdf) return { htmlFile, pdfFile: null, deferred: true };
  const browser = findBrowser();
  if (!browser) {
    return { htmlFile, pdfFile: null, warning: 'No Chrome or Edge found for headless PDF generation' };
  }

  return new Promise((resolve) => {
    execFile(browser, browserArgs(pdfFile, htmlFile), (err) => {
      if (err || !fs.existsSync(pdfFile)) {
        resolve({ htmlFile, pdfFile: null, warning: err ? err.message : 'PDF generation failed' });
      } else {
        resolve({ htmlFile, pdfFile, bytes: fs.statSync(pdfFile).size });
      }
    });
  });
}

/**
 * The weekly document: Regional Centre leaderboard, then component spend.
 * A separate file from the daily summary, but the same stylesheet, so the two
 * read as one publication.
 */
function generateWeeklyHtml(opts = {}) {
  const pages = [leaderboardPage(opts.leaderboard), componentLeaderboardPage(opts.componentWeek)]
    .filter(Boolean);
  if (!pages.length) return null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WEEKLY LEADERBOARD (${opts.asOn || ''})</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}

/**
 * How many pages a rendered PDF actually has.
 *
 * Read straight out of the file rather than with a PDF library: the page tree
 * root carries "/Count n", and that is all this needs. Keeping it dependency
 * free means the check can run on every report instead of only when someone
 * remembers to install a renderer and look.
 */
function pdfPageCount(file) {
  try {
    const buf = fs.readFileSync(file).toString('latin1');
    const counts = [...buf.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map(m => Number(m[1]));
    if (counts.length) return Math.max(...counts);
    // Fall back to counting leaf page objects.
    return (buf.match(/\/Type\s*\/Page[^s]/g) || []).length || null;
  } catch {
    return null;
  }
}

/**
 * Warn when a document runs longer than its layout intends.
 *
 * Every page here is designed to fill exactly one A4 sheet, so an extra page
 * means something overflowed — a stranded total row, a card cut in half. That
 * is invisible in the figures and only shows up on paper, which is precisely
 * why it is worth asserting automatically on each run.
 */
function checkPageCount(file, expected, label, warnings) {
  const actual = pdfPageCount(file);
  if (actual == null || !expected) return actual;
  if (actual !== expected) {
    warnings.push(
      `${label} rendered ${actual} pages but its layout is designed for ${expected}. ` +
      `Content has overflowed a sheet — check the last page for a stranded row or card.`
    );
  }
  return actual;
}

/** Render an HTML string to PDF beside it, sharing one headless-browser call. */
function htmlToPdf(html, outDir, baseName, skipPdf) {
  fs.mkdirSync(outDir, { recursive: true });
  const htmlFile = path.join(outDir, `${baseName}.html`);
  const pdfFile = path.join(outDir, `${baseName}.pdf`);
  fs.writeFileSync(htmlFile, html, 'utf8');

  /* Server: the PDF is rendered when somebody asks for it, not on every run.
     The HTML above is the exact file it prints from, so rendering later
     reproduces this run byte for byte. Upstream never sets this. */
  if (skipPdf) return Promise.resolve({ htmlFile, pdfFile: null, deferred: true });
  const browser = findBrowser();
  if (!browser) {
    return Promise.resolve({ htmlFile, pdfFile: null, warning: 'No Chrome or Edge found for headless PDF generation' });
  }
  return new Promise((resolve) => {
    execFile(browser, browserArgs(pdfFile, htmlFile), (err) => {
      if (err || !fs.existsSync(pdfFile)) {
        resolve({ htmlFile, pdfFile: null, warning: err ? err.message : 'PDF generation failed' });
      } else {
        resolve({ htmlFile, pdfFile, bytes: fs.statSync(pdfFile).size });
      }
    });
  });
}

/** Build the weekly leaderboard document. Returns null when there is nothing
 *  to show — a non-Monday run, or a Monday with no baseline to difference. */
async function buildWeeklyPdf(opts = {}) {
  const html = generateWeeklyHtml(opts);
  if (!html) return null;
  const outDir = opts.outDir || path.resolve('output');
  return htmlToPdf(html, outDir, `WEEKLY LEADERBOARD - ${opts.stamp || 'latest'}`, opts.skipPdf);
}

module.exports = {
  pdfPageCount,
  checkPageCount,
  generateReportHtml,
  generateWeeklyHtml,
  buildPdfAndHtml,
  buildWeeklyPdf,
  findBrowser,
  /* Exported for the server's on-demand PDF: it prints the HTML the run already
     stored, so the PDF is that run's, not a fresh reading of the sheet. */
  htmlToPdf,
};
