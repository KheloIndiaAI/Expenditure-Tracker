# Executive Financial Intelligence Platform — Product Requirements (PRD)

**Client:** Sports Authority of India (SAI), Ministry of Youth Affairs & Sports, Government of India
**Programme context:** Khelo India Scheme (KIS), FY 2026–27 — fund releases to Regional Centres and onward grantees
**Document set version:** 1.0 · Baseline
**Status:** Approved for build · Blueprint for engineering

---

## 1. What this document set is

This folder is the single source of truth for building the **Executive Financial Intelligence Platform** — a decision-support system that lets senior officials monitor, analyse, validate and explore SAI's expenditure from an executive summary all the way down to an individual voucher.

It is written to be handed to an engineering agent (e.g. Claude Code) or a delivery team and executed **document by document, phase by phase**. Each file is self-contained but cross-references the others by number. Read them in order the first time; thereafter treat `03_Data_Model.md`, `06_Validation_Framework.md` and `09_Design_System.md` as the three "law" documents that everything else must obey.

This is a specification, not marketing. Where a number, an entity name or a rule appears, it is drawn from the **actual FY 2026–27 dataset** (see §4), not invented. Any engineer should be able to trace every figure in these docs back to the source workbook.

## 2. Folder map

| File | Purpose | Primary audience |
|------|---------|------------------|
| `00_README.md` | This index — ground truth, glossary, conventions | Everyone |
| `01_Project_Vision.md` | Why we are building it, for whom, success criteria | Sponsors, leads |
| `02_System_Architecture.md` | Modules, layers, stack, data flow, deployment | Engineers, architects |
| `03_Data_Model.md` | Canonical hierarchy, star schema, data dictionary, taxonomy | Data + backend |
| `04_Dashboard_UI.md` | Information architecture, page-by-page specs | Design, frontend |
| `05_Features.md` | Functional features with acceptance criteria | PM, engineers, QA |
| `06_Validation_Framework.md` | Validation pipeline and full rule catalogue | Data, backend, QA |
| `07_Upload_System.md` | Upload → Validate → Publish workflow and versioning | Backend, ops |
| `08_User_Flows.md` | Key journeys, click-paths, diagrams | Design, PM, QA |
| `09_Design_System.md` | Tokens, components, charting, accessibility | Design, frontend |
| `10_Development_Roadmap.md` | Ten phases, exit criteria, testing, risks | Delivery lead |

## 3. How to use it with an engineering agent

1. Point the agent at this folder and instruct it to read `00`→`10` before writing code.
2. Execute **`10_Development_Roadmap.md` phase by phase**. Do not begin a phase until the previous phase's exit criteria are met.
3. Treat `03`, `06` and `09` as non-negotiable contracts. A change to any of them is a spec change and must be reflected across dependent documents before code follows.
4. Every KPI, chart and rule in `04`/`05`/`06` names the data-model entity it uses (from `03`). If a build decision contradicts `03`, the data model wins — raise it, don't silently diverge.
5. Excel is an **ingestion format only**. The platform's system of record is the database (see `02`, `03`, `07`). No feature may read the spreadsheet at runtime.

## 4. Ground truth — the FY 2026–27 baseline dataset

Every document is calibrated to this snapshot. The build's own reconciliation must reproduce these figures exactly.

| Measure | Value |
|---|---|
| Source | `RC_DETAIL_FOR_RECO_GOOGLE_SHEET_26-27_CLASSIFIED.xlsx` |
| Reporting period | Payment dates 13–19 May 2026 (weekly release cycle) |
| **Transactions** | **88** (a 89th `TOTAL` artifact row exists in the sheet and MUST be excluded) |
| **Net amount (sanctioned / "Limit Assigned")** | **₹27,77,81,215 ≈ ₹27.78 Cr** |
| **Utilised by RC** | **₹4,71,17,007 ≈ ₹4.71 Cr (17.0%)** |
| **Balance remaining with RC** | **₹23,06,64,208 ≈ ₹23.07 Cr (83.0%)** |
| Idle (0% utilised) transactions | 61 transactions worth ₹19.58 Cr |
| Fully utilised (100%) transactions | 23 transactions worth ₹4.35 Cr |
| Largest single transaction | ₹2,20,06,750 (Athlete Training Support–NCOE, sanction KITD/12) |
| Community split (General / SC / ST) | ₹20.80 Cr / ₹4.11 Cr / ₹2.87 Cr |
| Regional Centres | 13 (incl. DDO HQ) |
| Subverticals | 5 · Heads | 2 |
| Sub-categories in use | 14 (of a 40-term controlled vocabulary) |

**Reconciliation invariant (must always hold):** `Net Amount = Utilised + Balance`, and the total ties out three ways — MASTER DATA = the 13 Regional-Centre tabs = SUB CATEGORY MASTER = ₹27,77,81,215, difference **₹0**. This three-way tie-out already exists in the source workbook and the platform must preserve it as a first-class control (see `06`).

### The headline story the data tells
83% of released funds (₹23.07 Cr) are sitting **unutilised** with Regional Centres, including 61 releases that have **not moved at all**. Surfacing that — by centre, by scheme component, by grantee, by age — is the platform's reason to exist. See `01 §3`.

## 5. Domain glossary

| Term | Meaning |
|---|---|
| **SAI** | Sports Authority of India — the implementing body |
| **MYAS** | Ministry of Youth Affairs & Sports (Government of India) |
| **KIS** | Khelo India Scheme — the funding scheme in this dataset |
| **RC** | Regional Centre (13 in scope; e.g. SAI RC Kolkata) |
| **DDO / DDO HQ** | Drawing & Disbursing Officer; DDO HQ is the headquarters disbursing unit |
| **Head** | Top level of the financial hierarchy — Recurring or Non-Recurring |
| **Subvertical** | Scheme component — TID, KIC, Support to Academies, SPD, KIG |
| **Sub-category** | Standardised expenditure purpose (controlled vocabulary, 40 terms) |
| **Sub-category group** | Analytical roll-up of sub-categories (e.g. Athlete Development) |
| **Grantee** | The named recipient of a release (here mostly the RC, for onward release) |
| **TID** | Talent Identification and Development (subvertical) |
| **KIC** | Khelo India Centre |
| **KISCE** | Khelo India State Centre of Excellence |
| **NCOE** | National Centre of Excellence |
| **KIA** | Khelo India Athlete |
| **KIBG** | Khelo India Beach Games |
| **SPD / KIG** | Sports for Peace and Development / Khelo India Games (subverticals) |
| **PCA** | The per-KIC coach salary component (reimbursed as "Coach Salary (PCA)") |
| **NER** | North Eastern Region (Guwahati tab uses NER-prefixed community columns) |
| **BE** | Budget Estimate (top-down allocation; see the weekly Component Tracker) |
| **Net Amount** | Sanctioned / released amount ("Limit Assigned") for a transaction |
| **Utilisation by RC** | Amount actually spent by the Regional Centre against a release |
| **Balance remaining** | Net Amount − Utilisation (funds still idle with the RC) |
| **In Use / Reserved** | Taxonomy status — a category with FY data vs one held open for future use |
| **Limit Assigned** | The expenditure type for all current records (a released spending limit) |

## 6. Document conventions

- **Requirement IDs** use the form `FR-<area>-nn` (functional), `NFR-nn` (non-functional), `VR-nn` (validation rule). They are stable references; do not renumber.
- **Currency** is Indian Rupees, formatted in the **lakh/crore** system with the ₹ symbol (see `09 §9`). Crore = 10,000,000.
- **"Must / Should / May"** follow RFC-2119 intent: *must* = mandatory, *should* = strongly recommended, *may* = optional.
- **Severity** for validation and exceptions: `Blocker` (stops publish), `Warning` (publishes with flag), `Info` (logged only).
- Diagrams are written in Mermaid so they render in any Markdown viewer and stay diff-able in version control.

---

*Next: read `01_Project_Vision.md`.*
