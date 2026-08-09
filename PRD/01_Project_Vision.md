# 01 · Project Vision

> **One line:** Turn a weekly reconciliation spreadsheet into a decision-support system that tells a Joint Secretary, in thirty seconds, where SAI's money is — and where it is stuck.

---

## 1. The problem

SAI releases funds to 13 Regional Centres under the Khelo India Scheme and reconciles them weekly in a multi-tab Excel workbook. The workbook is, in fact, unusually disciplined — it already carries a classified master sheet, a 40-term controlled taxonomy, a three-way reconciliation and a data-quality log. But it remains a spreadsheet, and a spreadsheet has structural limits for executive decision-making:

- **The signal is buried.** The single most important fact in the current data — that **83% of released funds (₹23.07 Cr) are still idle with the Centres**, and 61 releases have not moved at all — is not visible on opening the file. It has to be computed, tab by tab, by someone who knows where to look.
- **There is no drill-down.** An executive who sees a large number cannot click it to ask "made of what? which centre? which grantee? which voucher?" without manual filtering across 13 sheets.
- **Integrity is fragile.** A stray `TOTAL` row already doubles the headline figure from ₹27.78 Cr to a false ₹55.56 Cr if summed naively. One mis-keyed cell can silently corrupt every derived number.
- **It doesn't scale or protect.** No version history, no rollback, no role-based access, no audit trail of who changed what. Weekly cadence across a full financial year will strain a single workbook.

The data is good. The **medium** is the bottleneck.

## 2. The objective

Build an **Executive Financial Intelligence Platform** — a decision support system, not merely a reporting dashboard — that:

1. Presents SAI's financial position so clearly that a non-financial executive understands it at a glance.
2. Lets any figure be traced from executive summary to the underlying voucher in **four clicks or fewer**.
3. Ingests the existing Excel workbook, **validates and stores** it in a database, and serves every view from that validated store.
4. Surfaces exceptions — idle balances, low utilisation, outliers, data-quality issues — **automatically**, without the user having to hunt.
5. Protects the numbers with validation, versioning, rollback, approvals and an immutable audit trail.

The platform must feel like premium enterprise software. The user should forget an Excel file was ever involved.

## 3. The story the data must tell (worked example)

This is the concrete outcome the vision is measured against, using the real baseline (`00 §4`):

> On opening the platform, the Executive Command Center shows **₹27.78 Cr sanctioned**, **17% utilised**, **₹23.07 Cr balance**, and a red exception band: *"61 releases (₹19.58 Cr) show zero utilisation."* One click drills the balance to **Regional Centre** — Kolkata (₹4.98 Cr across 13 releases) and Imphal (₹3.21 Cr) lead. Another click drills Kolkata to **sub-category** — the idle money is concentrated in Athlete Training Support (NCOE). A third click lists the **individual vouchers** with their sanction numbers and narrations. The Joint Secretary now knows *what*, *where*, *how much* and *which paper* — in under a minute, with no spreadsheet skills.

Everything in `04`, `05` and `08` exists to make that paragraph true.

## 4. Who it is for

The platform serves a chain of decision-makers, each asking a different question. The design must answer all of them from the same validated data.

| User | Core question | What they need |
|---|---|---|
| **Minister** | Is the scheme delivering, and is money moving? | A single confident headline: sanctioned, utilised, at-risk; national coverage across centres |
| **Secretary** | Where is performance strong or stuck? | Centre and component league tables; trend of utilisation; top risks |
| **Joint Secretary** | What needs my attention this week? | Exception center; concentration of spend and idle balance; drill-through to cause |
| **Director** | How does centre A compare to centre B? | Comparison mode; ranking; variance vs peers; per-component breakdowns |
| **Finance Officer** | Do the numbers reconcile and validate? | Upload/validate/publish; reconciliation panel; data-quality dashboard |
| **Programme Manager** | How is my subvertical (TID / KIC / …) doing? | Filtered subvertical view; grantee-level detail; utilisation by scheme line |
| **Analyst** | What is the pattern behind the number? | Full analytics — Pareto, treemap, heat map, waterfall; transaction explorer; export |
| **Auditor** | Can I trust and trace every figure? | Immutable audit trail; version history; transaction-level evidence; classification basis |

## 5. Core philosophy

The design obeys seven principles, in priority order:

1. **Data integrity over speed.** A correct slow answer beats a fast wrong one. The reconciliation invariant (`00 §4`) is sacred; the `TOTAL`-row trap must never recur.
2. **Hide complexity; reveal intelligence progressively.** Open on the one number that matters; let the user *ask for* depth rather than drowning in it.
3. **Every screen answers one business question.** If a page tries to answer three, it becomes a spreadsheet again. Split it.
4. **Every interaction reveals more insight.** Hover, click and filter always pay the user back with something they didn't have before.
5. **Every chart supports a decision.** No decoration. If a visual doesn't change what someone would do, cut it.
6. **Exceptions come to the user.** The platform does the hunting. Idle balance, low utilisation, outliers and quality issues are surfaced, not searched for.
7. **It should feel like premium software, not a spreadsheet.** Calm layout, confident typography, restraint. Enterprise, not office.

## 6. Product vision / north stars

The experience should sit comfortably next to: **Microsoft Power BI Service, SAP Analytics Cloud, Tableau Cloud, Oracle Analytics** (for analytical depth); **Bloomberg Terminal** (for information density done well); **Stripe Dashboard, Linear, Notion** (for calm, modern SaaS craft); and **Apple's Human Interface Guidelines** (for clarity and restraint). The chosen visual direction is **Modern SaaS, light** (see `09`).

## 7. Success criteria

The platform is successful when all of the following are demonstrably true.

| # | Criterion | How it is measured |
|---|---|---|
| SC-1 | Feels like enterprise software, not a dashboard-on-a-spreadsheet | Design review against `09`; unmoderated exec first-use test |
| SC-2 | A Joint Secretary understands SAI's financial position in **≤ 30 seconds** | Timed comprehension test on the Command Center |
| SC-3 | Any KPI traces to individual transactions in **≤ 4 clicks** | Click-path audit across every headline KPI (`08 §Flow B`) |
| SC-4 | Dashboard updates automatically from a validated Excel upload, **no manual edits** | End-to-end upload→publish with zero manual dashboard work (`07`) |
| SC-5 | Visually polished, intuitive, performant, secure, maintainable | Meets every `NFR` in `02 §8`; passes the `10` definition of done |
| SC-6 | Sets a benchmark for financial analytics in the Government of India | Reference-quality build; reusable for other schemes/ministries |
| SC-7 | Never displays an unvalidated or internally inconsistent figure | On validation failure, last-good dataset is shown (`06 §7`); invariant holds on every view |

## 8. Non-goals (explicitly out of scope for v1)

To keep the build honest, the following are **not** in the first release:

- **Editing financial data in the app.** The platform reads validated data; corrections happen at source (in the workbook / at the RC) and re-enter via upload. This preserves the "source text never altered" discipline the current workbook already follows.
- **Live integration with PFMS / SharePoint / OneDrive / ministry APIs.** Designed *for* later (see `02 §9`), not built now. Excel is the v1 ingestion channel.
- **Forecasting / predictive modelling.** v1 explains what *has* happened and what *needs attention*; it does not project.
- **Public / citizen-facing access.** Internal, authenticated, role-based only.
- **Mobile-native apps.** Responsive web is in scope; native iOS/Android is not.

## 9. Guiding metaphor

Think of the platform as a **control tower**, not a filing cabinet. A filing cabinet stores records and waits to be searched. A control tower watches everything at once, flags what is off-course, and lets the operator zoom from the whole airspace to a single aircraft instantly. SAI's money is the airspace; the idle ₹23 Cr is the aircraft holding on the runway; the platform is the tower.

---

*Next: read `02_System_Architecture.md`.*
