/**
 * Information architecture — implements PRD `04_Dashboard_UI.md §1`.
 *
 * The app is organised as enterprise software, not as a set of spreadsheet tabs.
 * Navigation is application-based, never worksheet-based.
 */

import type { Capability } from '@efip/shared';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Hidden unless the signed-in role holds this capability. */
  capability?: Capability;
  /** The one business question this page answers (04 §2). */
  question?: string;
}

export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: null,
    items: [
      { path: '/', label: 'Home', icon: 'Home', question: 'Where should I go, and what changed since last week?' },
      {
        path: '/command-center',
        label: 'Executive Command Center',
        icon: 'Gauge',
        question: 'What is SAI’s financial position right now, and what needs attention?',
      },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { path: '/overview', label: 'Financial Overview', icon: 'PieChart', question: 'How is the total made up, top to bottom?' },
      { path: '/head', label: 'Head Analysis', icon: 'Layers', question: 'Recurring vs Non-Recurring — how do they compare?' },
      { path: '/subvertical', label: 'Subvertical Analysis', icon: 'GitBranch', question: 'Which scheme component carries the money and the risk?' },
      { path: '/sub-category', label: 'Sub-Category Analysis', icon: 'Tags', question: 'What exactly is the money being spent on?' },
      { path: '/regional-centre', label: 'Regional Centre Dashboard', icon: 'Building2', question: 'How is each of the 13 centres performing?' },
      { path: '/grantee', label: 'Grantee Dashboard', icon: 'Users', question: 'Who is receiving the funds, and how much is moving?' },
      { path: '/trend', label: 'Trend Analysis', icon: 'TrendingUp', question: 'How is the position moving week over week?' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { path: '/exceptions', label: 'Exception Center', icon: 'TriangleAlert', question: 'What requires management attention?' },
      { path: '/transactions', label: 'Transaction Explorer', icon: 'Table2', question: 'Show me the vouchers themselves.' },
    ],
  },
  {
    title: 'Data',
    items: [
      { path: '/upload', label: 'Data Upload Center', icon: 'Upload', capability: 'upload_validate', question: 'Upload → Validate → Publish.' },
      { path: '/quality', label: 'Data Quality Dashboard', icon: 'ShieldCheck', question: 'Can I trust this dataset, and what should be corrected at source?' },
      { path: '/versions', label: 'Version History', icon: 'History', question: 'What changed, when, and by whom?' },
    ],
  },
  {
    title: 'System',
    items: [
      { path: '/settings', label: 'Settings', icon: 'Settings', question: 'Thresholds, taxonomy, users and formatting.' },
      { path: '/help', label: 'Help', icon: 'CircleHelp', question: 'How is a number calculated?' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function pageTitleFor(pathname: string): string {
  const exact = ALL_NAV_ITEMS.find((i) => i.path === pathname);
  if (exact) return exact.label;
  const prefix = ALL_NAV_ITEMS.filter((i) => i.path !== '/').find((i) => pathname.startsWith(i.path));
  return prefix?.label ?? 'Executive Financial Intelligence';
}
