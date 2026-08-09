# 05 · Feature Specification

> Each feature is specified with an ID, behaviour and **acceptance criteria** (AC) that QA can test. Features reference entities from `03` and drive the pages in `04`.

---

## 1. Feature map

| Area | Features |
|---|---|
| Executive intelligence | Command Center, insight cards, financial health score, top risks, rankings, variance, budget concentration, action recommendations |
| Exploration | Drill-through, cross-filtering, hover detail, universal search, bookmarks, saved views, comparison mode, reset, breadcrumbs, keyboard |
| Analytics | Pareto, treemap, heat map, waterfall, sunburst, scatter, ranking, matrix, bullet, sparkline, decomposition |
| Exceptions | Idle balance, low utilisation, outliers, duplicates, missing info, unknown category, concentration |
| Data | Upload, validate, publish, version history, rollback, data-quality dashboard (see `06`,`07`) |
| Governance | RBAC, audit trail, taxonomy governance, notifications, settings |

## 2. Executive intelligence

### 2.1 Executive Command Center — `FR-CC`
Single screen answering *what happened / why / where / what needs attention*.
- **FR-CC-01** Show the four headline KPIs and the health score above the fold.
- **FR-CC-02** Render 3–6 auto-generated insight cards ranked by materiality.
- **FR-CC-03** Every tile/card drills to a pre-filtered analysis page.
- **AC:** on load with baseline data, the page shows ₹27.78 Cr / 17% / ₹23.07 Cr, a health score, and an idle-balance risk card, in < 2 s (NFR-1).

### 2.2 Financial Health Score — `FR-HS`
A single 0–100 composite so executives get one defensible number. **All weights configurable in Settings**; defaults below.

| Component | Weight | Definition (0–100 sub-score) |
|---|---|---|
| Utilisation performance | 30% | `utilisation_pct` scaled against an expected pace for the elapsed period |
| Idle-balance control | 25% | inverse of `idle_balance / net_amount` (baseline idle = 70.5% of net → low sub-score) |
| Concentration risk | 15% | inverse of top-3-RC share of balance (Herfindahl-style) |
| Data quality | 20% | reconciliation pass (tie-out = ₹0) + (1 − open quality issues / txns) |
| Classification confidence | 10% | share of `explicit` basis (baseline 84/88 = 95%) |

- **FR-HS-01** Compute per version; show score, band (Critical/Weak/Fair/Strong), and the component breakdown on hover.
- **FR-HS-02** Never present the score without the breakdown — it must be explainable (SC-7).
- **AC:** given baseline data, the score is reproducible and its five components sum with the configured weights; changing a weight in Settings recomputes deterministically.

> On the baseline, the dominant drag is idle-balance control and utilisation — correctly, because 83% of funds haven't moved. The score should *feel* low, and the breakdown should say why.

### 2.3 Insight cards — `FR-INS`
Plain-language, data-derived statements ("AI-style", but rule-generated and auditable — no hallucination).
- Card types: largest exposure, lowest utilisation, biggest idle balance, fastest mover, concentration, community-equity note, data-quality alert.
- **FR-INS-01** Each card names the figure, the entity and a drill link; nothing is asserted that isn't computed from the current version.
- **AC:** every card's number can be reproduced from `fact_transaction`; no card text is free-form model output.

### 2.4 Rankings — `FR-RANK`
League tables for RC, grantee, subvertical, sub-category, sortable by net / utilisation% / balance / idle count, with rank movement vs previous version when available.

### 2.5 Variance & budget concentration — `FR-VAR`
- Variance: released vs BE-assigned (from `fact_budget_allocation`, `03 §5`); utilisation vs expected pace; week-over-week deltas.
- Concentration: Pareto — "top N centres hold X% of idle balance"; budget concentration by component.

### 2.6 Action recommendations — `FR-ACT`
Rule-based next-steps tied to exceptions: e.g. "Review 61 zero-utilisation releases (₹19.58 Cr) with the holding Centres." Recommendations are suggestions surfaced to executives, never automated financial actions.

## 3. Exploration & interaction

| ID | Feature | Behaviour | Acceptance |
|---|---|---|---|
| FR-EX-01 | Drill-through | Click a mark → descend one hierarchy level, filter to it, push a breadcrumb | Any KPI → transaction in ≤ 4 clicks (SC-3) |
| FR-EX-02 | Cross-filter | Selecting a mark filters all visuals on the page | Reversible via Reset |
| FR-EX-03 | Hover detail | Tooltip with exact figure, share of parent, utilisation% | Present on every plotted mark (`09 §8`) |
| FR-EX-04 | Reset filters | One control clears all filters/drill to the page default | Always visible in the filter bar |
| FR-EX-05 | Breadcrumbs | Full drill path, every crumb clickable | Reflects and controls state |
| FR-EX-06 | Dynamic titles | Title + one-liner restate current context | Updates on every filter change |
| FR-EX-07 | Bookmarks / saved views | Save a filter+drill state by name; reopen later; share via URL | State encoded in URL; role-safe |
| FR-EX-08 | Comparison mode | Two RCs (or subverticals) side by side, same measures | Used in `08 Flow E` |
| FR-EX-09 | Keyboard | ⌘K search; arrow/enter to drill; full keyboard operation | WCAG AA (`09 §10`) |
| FR-EX-10 | Export | Current view → CSV/Excel (data) or PDF (executive summary) | Respects active filters |

## 4. Analytics catalogue — right chart for the question

| Business question | Visualization | Where |
|---|---|---|
| What is the 80/20 of spend? | **Pareto** | Sub-Category, Concentration |
| How is the whole made of parts? | **Treemap / Sunburst** | Financial Overview |
| Sanctioned → Utilised → Balance | **Waterfall** | Overview, RC profile |
| Where is utilisation weak? | **Heat map** (RC × subvertical, coloured by utilisation band) | Subvertical, RC |
| How do centres rank? | **Ranked bar / league table** | RC, Grantee |
| How does it move over time? | **Line + sparklines** | Trend |
| Are there outliers? | **Scatter / box** (amount vs utilisation) | Exception Center |
| Utilisation vs target | **Bullet / gauge** | Command Center |
| Breakdown of one number | **Decomposition tree** | any drill |

Chart selection is governed by `09 §8` (one axis, categorical colour by identity, colourblind-safe palette). No dual-axis charts.

## 5. Universal search — `FR-SRCH`
- **FR-SRCH-01** One search box (and ⌘K) queries across RC, grantee, transaction (voucher/sanction/narration), sub-category, subvertical, head.
- **FR-SRCH-02** Results grouped by entity type; selecting a result navigates and filters the platform to it.
- **FR-SRCH-03** Free-text over narration supports partial matches (e.g. "Gopichand", "NCOE", "marathon").
- **AC:** results in < 300 ms (NFR-3); searching "Kolkata" filters to that RC; searching "KITD/12" opens the matching releases.

## 6. Exception engine — `FR-XC`
Exceptions are computed on publish and surfaced in the Exception Center (`04.10`). All thresholds live in Settings; defaults below, calibrated to the baseline.

| ID | Exception | Default rule | Severity | Baseline |
|---|---|---|---|---|
| FR-XC-01 | Idle balance | `utilisation = 0` and release age > 15 days | High | 61 (₹19.58 Cr) |
| FR-XC-02 | Low utilisation | `utilisation_pct < 25%` for releases older than 15 days | Medium | 63 |
| FR-XC-03 | Large release / outlier | `net_amount > mean + 2σ` **or** > ₹1 Cr | Medium | e.g. ₹2.20 Cr NCOE release |
| FR-XC-04 | Duplicate | same `sanction_no + grantee + net_amount`, or repeated `voucher_no` | High | screen on each upload |
| FR-XC-05 | Missing information | `classification_basis = contextual` or blank required field | Medium | 4 contextual |
| FR-XC-06 | Unknown category | `sub_category` outside the vocabulary | Blocker | 0 (must stay 0) |
| FR-XC-07 | Concentration | single RC holds > 20% of total balance | Info | Kolkata ~21% |
| FR-XC-08 | Community-equity flag | SC/ST share deviates materially from configured norm | Info | monitor |

- **FR-XC-09** Each exception item shows amount, centre, grantee, age, one-line reason and a drill link; queues are exportable.
- **AC:** with baseline data the Idle-Balance queue lists exactly 61 releases totalling ₹19.58 Cr.

## 7. Notifications — `FR-NOT`
- Trigger events: new/publish success, validation failure, new high-severity exceptions, rollback.
- Routed by role (Finance Officer gets validation results; Joint Secretary gets new high-severity exceptions).
- **AC:** a failed upload notifies the uploader with the itemised reasons; a publish notifies subscribed executives that the position refreshed.

## 8. Governance features
- **RBAC** (`07 §8`) — role matrix enforced at the data layer.
- **Audit trail** (`07 §7`) — every upload/publish/rollback/access recorded immutably.
- **Taxonomy governance** (`03 §7`) — controlled add/rename/retire of sub-categories, audited.
- **Settings** — thresholds, health-score weights, formatting, users/roles, notifications.

## 9. Export & reporting — `FR-RPT`
- Data export (CSV/Excel) of any filtered view or the full transaction grid.
- Executive summary export (PDF) of the Command Center — headline KPIs, health score, top exceptions, "as-of" version stamp — suitable for circulation to the Minister/Secretary.
- **AC:** exports carry the version id and generation timestamp; figures match on-screen exactly.

---

*Next: read `06_Validation_Framework.md`.*
