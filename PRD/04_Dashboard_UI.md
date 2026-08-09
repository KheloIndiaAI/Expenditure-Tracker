# 04 · Dashboard & UI Specification

> **Rule:** every page answers exactly one business question, opens on the single most important number, and lets the user *ask for* depth. Navigation is application-based, never worksheet-based.

---

## 1. Information architecture

The app is organised as enterprise software, not as a set of spreadsheet tabs. Left-hand navigation, grouped:

```
Home
Executive Command Center
─ ANALYSIS ────────────────
Financial Overview
Head Analysis
Subvertical Analysis
Sub-Category Analysis
Regional Centre Dashboard
Grantee Dashboard
Trend Analysis
─ INTELLIGENCE ────────────
Exception Center
Transaction Explorer
Universal Search        (global, also ⌘K)
─ DATA ────────────────────
Data Upload Center
Data Quality Dashboard
Version History
─ SYSTEM ──────────────────
Settings
Help
```

Navigation collapses to icons on narrow viewports. The active page, current version ("Data as of v7 · 26 May 2026") and the signed-in role are always visible in the top bar.

## 2. The universal page template

Every analysis page is built from the same anatomy so the product feels like one system:

```
┌ Breadcrumb: Home ▸ Regional Centre ▸ Kolkata ───────────────── [version] [role] ┐
│ Page title (dynamic)              1-line answer to this page's question          │
│ ── Filter bar (one row): Head · Subvertical · Sub-Category · RC · Date · Reset ──│
│ ┌ KPI row (3–5 stat tiles) ─────────────────────────────────────────────────┐  │
│ ┌ Primary visualization ──────────────┐ ┌ Insight panel (contextual cards) ─┐  │
│ ┌ Secondary viz / ranking / table ────────────────────────────────────────┐  │
│ ── Related pages · Export · Actions ──────────────────────────────────────── │
└──────────────────────────────────────────────────────────────────────────────┘
```

Mandatory elements on every analysis page (`04` acceptance): **purpose, KPIs, visualization(s), contextual insights, filters, drill-down, export, breadcrumb, related pages, action items.**

## 3. Cross-cutting interaction model

- **Drill-down** follows the hierarchy in `03 §1`. Clicking any dimension mark descends one level and filters to it; the breadcrumb records the path and every crumb is clickable to jump back.
- **Cross-filtering.** Selecting a mark in one visual filters the others on the page. A selection is always reversible (Reset filters).
- **Progressive disclosure.** Pages open collapsed to the headline; detail (tables, secondary charts) expands on demand.
- **Dynamic titles.** Titles and the one-line answer restate the current filter context ("Balance remaining — SAI RC Kolkata, Recurring").
- **State in the URL.** Filter + drill state is encoded in the URL so any view is shareable and bookmarkable (`05 §3`).
- **Every number is a link.** A KPI, a bar, a treemap cell — all drill toward the transactions behind them (SC-3: ≤ 4 clicks).

## 4. Page specifications

Each page below is specified as: **Question · KPIs · Visuals · Filters · Drill · Insights · Actions · Related.** Figures are baseline examples.

### 4.1 Home
- **Question:** Where should I go, and what changed since last week?
- **Content:** role-aware launcher — headline position (₹27.78 Cr / 17% / ₹23.07 Cr), the 3 highest-priority exceptions, "what changed vs previous version" (new releases, utilisation movement), quick links to the pages this role uses most, and saved views.
- **Actions:** jump to Command Center; open top exception; resume a saved view.

### 4.2 Executive Command Center  *(the 30-second page — SC-2)*
- **Question:** What is SAI's financial position right now, and what needs attention?
- **KPIs (stat tiles):** Total Sanctioned ₹27.78 Cr · Utilised ₹4.71 Cr (17%) · Balance ₹23.07 Cr (83%) · **Financial Health Score** (see `05 §2.2`) · Idle Releases 61 (₹19.58 Cr).
- **Visuals:** a utilisation gauge/bullet (17% vs an expected pace); a compact Regional-Centre league table (balance + utilisation%); an "AI-style" insight card stack (top risks, biggest area, lowest utilisation); a concentration mini-Pareto (top centres = X% of balance).
- **Insights (auto):** "61 releases (₹19.58 Cr) unutilised", "Kolkata holds the largest idle balance (₹4.98 Cr)", "Athlete Training Support–NCOE is the single largest exposure (₹9.82 Cr)".
- **Drill:** every tile and row descends into the matching analysis page, pre-filtered.
- **Actions:** open Exception Center; export executive summary (PDF); bookmark.

### 4.3 Financial Overview
- **Question:** How is the total made up, top to bottom?
- **KPIs:** the four headline measures + community split (General ₹20.80 Cr / SC ₹4.11 Cr / ST ₹2.87 Cr).
- **Visuals:** a **sunburst or treemap** of Head → Subvertical → Sub-category; a **waterfall** Sanctioned → Utilised → Balance; the community-split bar. Everything drillable.
- **Related:** Head, Subvertical, Sub-Category analysis.

### 4.4 Head Analysis
- **Question:** Recurring vs Non-Recurring — how do they compare?
- **KPIs:** per-head net, utilisation%, balance (Recurring ₹19.95 Cr / Non-Recurring ₹7.83 Cr).
- **Visuals:** side-by-side bars; utilisation% comparison; each head's subvertical breakdown.

### 4.5 Subvertical Analysis
- **Question:** Which scheme component carries the money and the risk?
- **KPIs:** 5 subverticals ranked; TID leads at ₹11.63 Cr.
- **Visuals:** ranked bar by net; utilisation heat (subvertical × utilisation band); balance-at-risk callout. Drills to sub-category then RC.

### 4.6 Sub-Category Analysis
- **Question:** What exactly is the money being spent on?
- **KPIs:** 14 in-use categories; Athlete Training Support (NCOE) ₹9.82 Cr top.
- **Visuals:** Pareto of sub-categories (80/20); group roll-up (Athlete Development, Equipment & Consumables…); In-Use vs Reserved coverage. Links to taxonomy (Settings).

### 4.7 Regional Centre Dashboard
- **Question:** How is each of the 13 centres performing?
- **KPIs:** selected RC's net, utilisation%, balance, rank, txn count.
- **Visuals:** RC league table (sortable: net, utilisation%, balance, idle count); a per-RC profile (its subvertical + sub-category mix, its transactions); a map/region view (NER vs rest optional). Comparison mode pits two RCs side by side (`05 §3`).
- **Drill:** RC → sub-category → grantee → transaction.

### 4.8 Grantee Dashboard
- **Question:** Who is receiving the funds, and how much is moving?
- **KPIs:** grantee net, utilisation, balance, releases.
- **Visuals:** grantee ranking; grantee → transaction detail. Built to accommodate downstream grantees (academies, KICs, NCOEs) as data records them.

### 4.9 Trend Analysis
- **Question:** How is the position moving week over week?
- **Visuals:** utilisation% over versions; balance burn-down; new-release volume by week; sparklines per RC. Powered by version diffs (`03 §9`). With a single baseline week, this page shows the framework and fills as versions accrue — stated honestly, not faked.

### 4.10 Exception Center  *(intelligence, not search)*
- **Question:** What requires management attention?
- **Content:** grouped exception queues, each a rule from `05 §6` — Idle Balance (61), Low Utilisation (< 25%), Large Releases (outliers), Duplicates, Missing Information, Unknown Category. Each item: amount, centre, grantee, age, one-line reason, and a drill link.
- **Actions:** open the underlying transaction(s); export a queue; (future) assign/annotate.

### 4.11 Transaction Explorer
- **Question:** Show me the vouchers themselves.
- **Content:** the full 88-row grid — sortable, filterable, column-configurable, densely formatted (tabular figures). Columns: date, voucher, sanction, RC/grantee, head, subvertical, sub-category, net, utilised, balance, utilisation%, community split, narration (expandable). This is the bottom of every drill-down (SC-3).
- **Actions:** export (CSV/Excel), copy a row's audit reference, open source-row provenance.

### 4.12 Data Upload Center — see `07`
Three visible steps only: **Upload → Validate → Publish**. Validation report and diff-vs-current shown inline; publish gated on role + passing blockers.

### 4.13 Data Quality Dashboard
- **Question:** Can I trust this dataset, and what should be corrected at source?
- **Content:** the reconciliation panel (three-way tie-out = ₹0), validation control results (all `PASS`/fail with counts), and the **Data Quality Log** — the 12 observations (narration/grantee mismatch, purpose-not-stated, typographic errors, header inconsistency), each with sheet, row, issue type and observation. Mirrors and elevates the workbook's existing discipline.

### 4.14 Version History
- Chronological list of published versions with who/when, a diff to the prior version, and a one-click **rollback** (checker role). Feeds `08` approval/rollback flow.

### 4.15 Settings
- Threshold configuration (exception limits, health-score weights), **taxonomy governance** (In Use/Reserved terms, add/rename/retire — audited), number/date formatting, user & role management, notification preferences.

### 4.16 Help
- Contextual guidance, the glossary (`00 §5`), keyboard shortcuts, and a "how a number is calculated" explainer for every KPI.

## 5. Component patterns (see `09` for tokens)
Stat tile, KPI row, insight card, league table (dense financial table with tabular figures), Pareto/treemap/waterfall/heat-map/sunburst, gauge/bullet, filter bar, chip, breadcrumb, drill panel, exception queue item, reconciliation panel, diff view, empty/loading/skeleton/error states.

## 6. States
Every data region specifies four states: **loading** (skeleton, never a spinner-only blank), **empty** (explains why and what to do — e.g. Trend with one version), **error** (actionable, preserves last-good), and **populated**. No screen ever shows a raw error or a silent blank.

## 7. Responsive behaviour
Desktop-first (the executive context is a briefing screen), gracefully responsive to tablet. Below tablet: navigation collapses, KPI rows stack, tables become horizontally scrollable with sticky first column, charts drop non-essential decoration but never their meaning.

## 8. Accessibility (summary; full spec `09 §10`)
Full keyboard operation, visible focus, WCAG AA contrast, identity never by colour alone (legend + label + optional texture), and a table view behind every chart.

---

*Next: read `05_Features.md`.*
