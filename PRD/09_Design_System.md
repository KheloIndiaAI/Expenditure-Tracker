# 09 · Design System

> **Law document.** Direction: **Modern SaaS, light** — calm, premium, confident, in the register of Stripe, Linear and Power BI. Everything is token-driven so the UI never drifts and dark mode is a re-theme, not a rebuild.

---

## 1. Design principles
1. **Clarity over decoration.** Every pixel earns its place; whitespace is a feature, not waste.
2. **One accent, used sparingly.** A single primary carries brand and action; data carries the colour weight, not chrome.
3. **Numbers are the hero.** Financial figures get the strongest typographic treatment; everything else recedes.
4. **Consistent by tokens.** Colours, spacing, type and radius come from named tokens only — no ad-hoc hex or px in components.
5. **Accessible by construction.** WCAG AA minimum; identity never by colour alone.

## 2. Colour — foundation (light)

| Role | Token | Hex |
|---|---|---|
| Page plane | `--bg-page` | `#f9f9f7` |
| Surface / card | `--bg-surface` | `#ffffff` |
| Surface (raised) | `--bg-raised` | `#fcfcfb` |
| Primary text | `--text-primary` | `#0b0b0b` |
| Secondary text | `--text-secondary` | `#52514e` |
| Muted (axis/labels) | `--text-muted` | `#898781` |
| Hairline border | `--border` | `rgba(11,11,11,0.10)` |
| Gridline | `--grid` | `#e1e0d9` |

### 2.1 Primary accent
| Token | Hex | Use |
|---|---|---|
| `--primary` | `#256abf` | Primary actions, active nav, links, focus |
| `--primary-hover` | `#1c5cab` | Hover/pressed |
| `--primary-subtle` | `#cde2fb` | Selected row wash, badges |

A single institutional blue — professional, government-appropriate, and the same hue family as the data-viz sequential ramp, so charts and chrome feel unified.

### 2.2 Semantic / status (fixed — never used as a series colour)
| Role | Token | Hex | Meaning in this product |
|---|---|---|---|
| Good | `--status-good` | `#0ca30c` | Reconciled, fully utilised, on-track |
| Warning | `--status-warn` | `#fab219` | Low utilisation, review needed |
| Serious | `--status-serious` | `#ec835a` | High idle balance |
| Critical | `--status-critical` | `#d03b3b` | Failed validation, blocker, large exposure |

Status colours always ship with an **icon + label**, never colour alone (`§10`). They are deliberately distinct from the chart series palette so a status can never impersonate a data series.

## 3. Data-visualization palette (validated, colourblind-safe)

Categorical series use this fixed eight-hue order — **assigned in order, never cycled**. Adopted from the validated reference palette and re-checked against our surfaces (`validate_palette.js`: all hard gates pass, worst adjacent CVD ΔE 9.1).

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4a3aa7` | `#9085e9` |
| 8 | red | `#e34948` | `#e66767` |

**Rules (non-negotiable):**
- **Colour follows the entity, not its rank** — a filter that drops series must not repaint the survivors (e.g. each Regional Centre keeps its hue across every chart).
- **Sequential** (utilisation intensity, heat maps) = one hue, light→dark, blue ramp `#cde2fb → #0d366b`. **Diverging** (variance vs plan, above/below target) = blue ↔ red with a neutral grey midpoint (`#f0efec`). Never a rainbow; never a hue at the diverging midpoint.
- **One axis, ever.** No dual-axis charts. Two measures of different scale → two charts or index to a common base.
- **Scatter/bubble/small-multiples** cap at the **first three slots** (blue, orange, aqua) validated all-pairs; beyond three, fold to "Other" or facet.
- Three light-mode slots (aqua, yellow, magenta) sit below 3:1 on white → the **relief rule** applies: ship visible direct labels or the table view (already required by `04 §8`).
- Text (values, labels, legends) wears text tokens, **never** the series colour.

## 4. Typography
System sans throughout: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. No serif or display face. Optionally standardise on **Inter** (self-hosted) for cross-platform consistency.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--display` | 40 / 44 | 600 | Hero figure (Command Center headline) |
| `--h1` | 28 / 34 | 600 | Page title |
| `--h2` | 22 / 28 | 600 | Section |
| `--h3` | 18 / 24 | 600 | Card heading |
| `--body` | 15 / 22 | 400 | Body text |
| `--label` | 13 / 18 | 500 | Labels, filters |
| `--caption` | 12 / 16 | 400 | Captions, footnotes |
| `--kpi` | 32 / 36 | 700 | Stat-tile value |

- **Tabular figures** (`font-variant-numeric: tabular-nums`) on all table columns, axis ticks and any vertically-aligned numbers. Large standalone figures (KPIs, hero) use default proportional figures.

## 5. Spacing, radius, grid
- **Spacing** on a 4px base: `4, 8, 12, 16, 24, 32, 48, 64`. Tokens `--space-1…8`.
- **Radius:** `--radius-sm 6px` (inputs, chips), `--radius-md 10px` (cards), `--radius-lg 14px` (modals). Data bars use a 4px rounded end.
- **Grid:** 12-column, `--container-max 1440px`, gutter 24px. Content max-width for reading blocks ~ 72ch.
- **Breakpoints:** `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1440`. Desktop-first (`04 §7`).

## 6. Elevation (shadows)
Restrained; light-mode depth from soft shadows, not borders-everywhere.
| Token | Shadow | Use |
|---|---|---|
| `--elev-0` | none (hairline border) | Flat surfaces, tables |
| `--elev-1` | `0 1px 2px rgba(11,11,11,.06)` | Cards, tiles |
| `--elev-2` | `0 4px 12px rgba(11,11,11,.08)` | Popovers, dropdowns |
| `--elev-3` | `0 12px 32px rgba(11,11,11,.12)` | Modals, command palette |

## 7. Core components

| Component | Spec highlights |
|---|---|
| **Button** | Primary (filled `--primary`), secondary (hairline), ghost, destructive (`--status-critical`). 36px default height, `--radius-sm`, `--label` type, visible focus ring. |
| **Stat tile / KPI** | Label (`--label`, muted) · value (`--kpi`, tabular) · delta chip with ▲/▼ + status colour + text · optional sparkline. Never delta by colour alone. |
| **Insight card** | Icon · one-sentence statement (`--body`) · the figure (semibold) · drill link. Severity via left-border status colour + icon. |
| **League table** | Dense, `--elev-0`, tabular figures, sticky header, zebra off (hairlines only), sortable columns, selected row `--primary-subtle`, right-aligned numbers. |
| **Filter bar** | One row above content; chips for active filters; **Reset** always present. |
| **Chip / badge** | Status (icon+label+colour), taxonomy (In Use / Reserved), version. |
| **Breadcrumb** | Full drill path, `▸` separators, each crumb a button. |
| **Chart frame** | Title + one-line answer, recessive grid/axes (`--grid`, `--text-muted`), legend for ≥2 series, hover tooltip default, "view as table" affordance. |
| **Tooltip** | `--elev-2`, exact figure (tabular) + share-of-parent + utilisation%. |
| **States** | Skeleton (never a lone spinner), empty (explains + next action), error (actionable, keeps last-good). |
| **Command palette (⌘K)** | `--elev-3`, universal search, keyboard-first. |

## 8. Charting guidelines (applies to every visual in `04`/`05`)
- Pick the form by the data's job (magnitude → bar; part-of-whole → treemap/sunburst; flow → waterfall; intensity → heat map; change → line). Sometimes the answer is a **stat tile, not a chart**.
- Thin marks; 2px lines; ≥8px dot markers; 4px rounded, baseline-anchored bar ends; a 2px surface gap between adjacent/stacked fills.
- Recessive axes and gridlines; **direct-label** selectively (never a number on every point).
- **Hover layer by default** on every plotted chart; filters in one row above.
- Legend present for ≥2 series and ≤4 also direct-labelled; a table view exists behind every chart; texture channel available for the CVD/print/forced-colours case.
- Validate any changed categorical palette with the script before shipping; don't eyeball CVD.

## 9. Data formatting standards (India-specific)
- **Currency:** ₹ with the **lakh/crore** grouping. Executive surfaces show crore to 2 decimals ("₹27.78 Cr"); detail grids show full rupees with Indian digit grouping ("₹27,77,81,215"); a consistent `formatINR(value, {unit})` helper is the single source.
- **Crore/lakh thresholds:** ≥ ₹1 Cr → Cr; ₹1 lakh–1 Cr → L; below → full rupees. Configurable in Settings.
- **Percentages:** whole or one-decimal ("17%", "17.0%"); utilisation always shown with its rupee context.
- **Dates:** `DD Mmm YYYY` ("19 May 2026"); the reporting week visible where relevant.
- **Large-number safety:** never sum a column that may contain a `TOTAL` artifact row (`06 VR-11`); formatting helpers assume clean, validated data only.

## 10. Accessibility
- **Contrast:** text and essential UI meet WCAG AA (4.5:1 body, 3:1 large/graphical). The three sub-3:1 chart hues carry the relief rule (`§3`).
- **Keyboard:** full operation — nav, drill, filter, search (⌘K), tables; visible focus ring (`--primary`), logical tab order, no keyboard traps.
- **Identity never colour-alone:** legends + labels + optional texture; status = icon + label + colour.
- **Screen readers:** semantic landmarks, labelled controls, chart data available as a table; live-region announcements for filter/version changes.
- **Motion:** subtle, purposeful (150–200ms ease); honour `prefers-reduced-motion`.

## 11. Dark mode (future-ready, tokenised now)
Every colour is a token with a declared dark value (foundations + the dark chart column in `§3`). Dark mode is a **selected** theme — its chart steps are validated against the dark surface `#1a1a19`, not an automatic inversion. Building token-first in v1 means dark mode ships later as configuration, not a refactor.

## 12. Iconography
One line-icon set (e.g. Lucide), 1.5px stroke, 20px default, aligned to the text baseline. Icons support labels; they never replace them for meaning-critical states.

---

*Next: read `10_Development_Roadmap.md`.*
