# 10 · Development Roadmap

> **Rule:** iterative delivery. Complete a phase — meet its **exit criteria** — before starting the next. Each phase produces something demonstrable. No big-bang build.

---

## 1. Phase overview

```mermaid
flowchart LR
  P1["1 Core Architecture"] --> P2["2 Data Model & Ingestion"] --> P3["3 Dashboard"]
  P3 --> P4["4 Analytics"] --> P5["5 Upload System"] --> P6["6 Validation"]
  P6 --> P7["7 Insights & Exceptions"] --> P8["8 Optimization"] --> P9["9 Testing"] --> P10["10 Documentation"]
```

| Phase | Goal | Primary spec |
|---|---|---|
| 1 | Foundations, stack, auth, design tokens | `02`, `09` |
| 2 | Data model, ingestion, classification | `03`, `07` |
| 3 | Core dashboard + drill-down | `04` |
| 4 | Analytics visual library | `05 §4` |
| 5 | Upload → validate → publish workflow | `07` |
| 6 | Full validation catalogue + reconciliation | `06` |
| 7 | Insight engine, health score, exceptions, search | `05 §2,§5,§6` |
| 8 | Performance, caching, accessibility hardening | `02 §6,§8`, `09 §10` |
| 9 | Test suite, UAT, security review | this doc §4 |
| 10 | Documentation, handover, training | `00`–`09` |

## 2. Phase detail

### Phase 1 — Core Architecture
**Scope:** repo, CI, environments (dev/staging/prod); React+TS+Tailwind+shadcn scaffold; Supabase project (Postgres, Auth, Storage, RLS); design tokens from `09` wired into Tailwind; app shell (nav, top bar, routing); role model stub.
**Deliverables:** running skeleton app, auth login, tokenised theme, empty routed pages.
**Exit criteria:** a user can log in, see the nav/IA from `04 §1`, and the design tokens render; CI builds and deploys to staging.

### Phase 2 — Data Model & Ingestion
**Scope:** implement the star schema (`03`); build the parser for the 13 RC tabs + masters; header harmonisation (incl. Guwahati NER-*); artifact-row exclusion (TOTAL guard); classification engine (explicit → contextual); load the baseline workbook.
**Deliverables:** the baseline 88 transactions in the Published store, three-way tie-out reproduced (₹27,77,81,215).
**Exit criteria:** database totals match `00 §4` exactly; `TOTAL` row is excluded; taxonomy loaded (40 terms, In Use/Reserved derived). *This is the correctness gate for everything downstream.*

### Phase 3 — Dashboard
**Scope:** Executive Command Center, Financial Overview, the hierarchy analysis pages, Regional Centre & Grantee dashboards, Transaction Explorer; the universal page template, filter bar, breadcrumb, drill-through, cross-filter, dynamic titles, URL state.
**Deliverables:** the core navigable, drillable product on real data.
**Exit criteria:** SC-2 (30-second Command Center) and SC-3 (KPI → transaction in ≤ 4 clicks) demonstrably met on baseline data.

### Phase 4 — Analytics
**Scope:** the visual library (`05 §4`) — Pareto, treemap/sunburst, waterfall, heat map, ranking, bullet/gauge, sparklines, decomposition — all themed to `09 §3` and validated.
**Deliverables:** each analysis page's charts answering its one question.
**Exit criteria:** every chart obeys the charting rules (one axis, entity-stable colour, colourblind-safe, hover + table view); no dual-axis anywhere.

### Phase 5 — Upload System
**Scope:** Data Upload Center (Upload → Validate → Publish), staging, diff-vs-current, versioning, maker-checker approval, rollback, Version History, audit events, RBAC at the data layer.
**Deliverables:** a second (or synthetic next-week) workbook uploaded and published end-to-end.
**Exit criteria:** SC-4 met — dashboard updates from a validated upload with zero manual editing; rollback restores a prior version within NFR-5.

### Phase 6 — Validation
**Scope:** the full rule catalogue (`06`) across all six layers; the reconciliation panel; duplicate/outlier logic; the reject-and-keep-last-good behaviour; validation report UX.
**Deliverables:** validation gating live in the upload flow.
**Exit criteria:** a deliberately broken workbook is rejected with itemised errors and the live dashboard stays on the last good version (SC-7); all baseline controls report as in the workbook (VR-13/14 tie-out = ₹0).

### Phase 7 — Insights & Exceptions
**Scope:** insight-card engine, financial health score (with configurable weights + explainable breakdown), Exception Center queues (idle balance, low utilisation, outliers, duplicates, missing info, unknown category, concentration), universal search, notifications, action recommendations.
**Deliverables:** the "intelligence" layer — exceptions surfaced automatically.
**Exit criteria:** SC-1 sense — the Idle-Balance queue shows the 61 releases (₹19.58 Cr) automatically; search returns entities < 300 ms; every insight number is reproducible from data (no free-form model text).

### Phase 8 — Optimization
**Scope:** compute-on-publish materialisations, three-tier caching, code-splitting, query tuning, accessibility hardening (WCAG AA), responsive polish.
**Deliverables:** the performance and accessibility targets.
**Exit criteria:** NFR-1…5 met (dashboard < 2s, filter < 500ms, search < 300ms, parse+validate < 20s, publish→refresh < 30s); `09 §10` accessibility pass.

### Phase 9 — Testing
**Scope:** the test strategy in §4 — unit, integration, end-to-end, reconciliation/data-integrity tests, security review, and formal UAT with finance users.
**Deliverables:** green test suite + signed-off UAT.
**Exit criteria:** the Definition of Done (§6) is met for every feature; security review has no high findings.

### Phase 10 — Documentation
**Scope:** finalise these PRD docs against the built system; user guide per role; admin/ops runbook (upload cadence, rollback, taxonomy governance); developer README + architecture notes; in-app Help (`04.16`).
**Deliverables:** complete documentation set + training material.
**Exit criteria:** a new engineer can build/run from docs; a finance user can complete the weekly cycle unaided.

## 3. MVP definition
The **minimum releasable** product is **Phases 1–3 + Phase 6's reconciliation/blocker rules on the baseline load**: a logged-in user sees a correct Command Center and can drill any KPI to the vouchers, on validated data whose totals tie out. That alone delivers SC-2, SC-3 and the integrity guarantee — the core value — before the upload workflow and analytics library are complete. Ship it to a small executive group, then continue Phases 4→10.

## 4. Testing strategy

| Level | What | Notes |
|---|---|---|
| Unit | Parser, header harmonisation, classification rules, `formatINR`, health-score math, each validation rule | Deterministic; fixtures from the real workbook |
| Data-integrity | Reconciliation tie-out, invariant `net = utilised + balance`, community split, TOTAL-row exclusion | **Golden test:** baseline must reproduce ₹27,77,81,215 and 88 rows |
| Integration | Upload → stage → validate → publish; RLS role enforcement; version/rollback | Against a staging Supabase |
| End-to-end | The `08` flows A–H, click-counted | SC-2/SC-3 asserted in E2E |
| Performance | NFR-1…5 under representative data volumes (scale to 10⁵ rows) | Regression-gated |
| Accessibility | Automated (axe) + manual keyboard/screen-reader | WCAG AA |
| Security | RBAC bypass attempts, file-upload abuse, audit completeness | Pre-release review |
| UAT | Finance officers run a real weekly cycle; executives run a briefing | Sign-off gate |

## 5. Risk register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Silent data-integrity error (another TOTAL-row-type artifact) | High | Medium | Golden reconciliation test + Blocker rules VR-11/13/14 on every upload |
| Source workbook format drifts (new headers/tabs) | Medium | Medium | Header harmonisation surfaces unknowns as Blockers, never guesses (VR-03) |
| Classification ambiguity grows as spend diversifies | Medium | Medium | Reserved vocabulary already defined; contextual basis logged for confirmation |
| Scope creep toward the "full vision" at once | Medium | High | Phase gates; MVP first; exit criteria enforced |
| Performance degrades as multi-year data accrues | Medium | Low-Med | Compute-on-publish + caching (`02 §6`); perf regression gates |
| Government hosting/compliance constraints | Medium | Medium | Portable Postgres stack; RLS at data layer; on-prem option (`02 §4`) |
| Weak utilisation is read as a *tool* failure, not a *fund-flow* fact | Low | Medium | Insights explain the "why" and cite vouchers; the tool reports reality, doesn't judge it |

## 6. Definition of Done (per feature)
A feature is done when: it meets its acceptance criteria in `04`/`05`/`06`/`07`; it obeys `03` (data model) and `09` (design/accessibility); it has unit + integration tests passing; it is keyboard-accessible and AA-contrast; it degrades gracefully (loading/empty/error states); it never displays an unvalidated or internally inconsistent figure (SC-7); and it is documented (in-app Help + code).

## 7. Decision-making principle (standing guidance for the build)
When multiple implementations exist, choose — in order — the most **scalable**, the most **maintainable**, the **cleanest architecture**, optimised for long-term government ownership. Never sacrifice architecture for speed; surface trade-offs rather than hiding them. Integrity always outranks convenience.

---

*End of PRD. Return to `00_README.md` for the index.*
