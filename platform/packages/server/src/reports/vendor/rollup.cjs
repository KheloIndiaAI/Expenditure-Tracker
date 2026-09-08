'use strict';
const { norm } = require('./util.cjs');

/**
 * Combine the cumulative master sheet with one day's RBI claims.
 *
 * Cumulative division figures come from Sheet3, which is component-attributed.
 * The RBI report is not component-attributed, so it supplies the day's totals
 * (overall, and split by stream) rather than being forced into a division.
 */
function rollup({ master, rbi, dsc, config, resolver }) {
  const warnings = [];
  const byName = new Map(master.components.map(c => [norm(c.name), c]));
  const claimed = new Set();

  const targets = config.componentTargets || {};
  const componentLabels = config.componentLabels || {};

  const divisions = config.divisions.map(d => {
    let expenditure = 0;
    let limitAssigned = 0;
    let actualExp = 0;
    let directExp = 0;
    const components = [];

    if (d.source === 'kiInfraStates') {
      expenditure = master.kiInfraTotal ? master.kiInfraTotal.expenditure : 0;
      limitAssigned = master.kiInfraTotal ? master.kiInfraTotal.limitAssigned : 0;
      actualExp = expenditure;
    } else {
      for (const name of d.components || []) {
        const c = byName.get(norm(name));
        if (!c) { warnings.push(`Division ${d.key}: component "${name}" is not in ${master.tab}.`); continue; }
        claimed.add(norm(name));
        expenditure += c.totalExp;
        limitAssigned += c.limitAssigned;
        actualExp += c.actualExp;
        directExp += c.directExp;
        const target = Object.prototype.hasOwnProperty.call(targets, name) ? Number(targets[name]) || 0 : null;
        components.push({
          name,
          label: componentLabels[name] || name,
          section: c.section,
          target,
          expenditure: c.totalExp,
          balance: target != null ? target - c.totalExp : null,
          hasSpend: c.totalExp > 0,
        });
      }
    }

    const assigned = Number(d.assigned) || 0;
    const fundedComponents = components.filter(c => c.target != null && c.target > 0);

    // A division with SOME targets set and SOME missing is very likely an
    // oversight (a new component added, or one target never filled in) rather
    // than intentional — that gap would otherwise silently undercount
    // "funded components" with nothing to say why.
    const withTarget = components.filter(c => c.target != null);
    if (withTarget.length > 0 && withTarget.length < components.length) {
      const missing = components.filter(c => c.target == null).map(c => c.label);
      warnings.push(
        `${d.label}: ${missing.length} of ${components.length} components have no target set ` +
        `(${missing.join(', ')}) while the rest do — "funded components" for this division will undercount ` +
        `until every component either has a target or none do. Fill it in on the Divisions page or in componentTargets.`
      );
    }

    return {
      key: d.key,
      label: d.label || d.key,
      // Carried through so downstream code can tell a component-backed
      // division from one fed by the KI Infra table (the report's
      // "% of scheme" excludes the latter, as the PDF does).
      source: d.source || null,
      // How the report PDF writes this division's name — its headings use
      // spaces ("KI 1") and its infra cards say "INFRA", not "SAI-INFRA".
      reportHeading: d.reportHeading || d.label || d.key,
      cardPrefix: d.cardPrefix || d.label || d.key,
      tagline: d.tagline || null,
      assigned,
      expenditure,
      balance: assigned - expenditure,
      limitAssigned,
      actualExp,
      // Limit pushed out to Regional Centres that they have not yet spent.
      // Only meaningful for component-based divisions: a "source" division
      // (MSD-INFRA) draws its limitAssigned/actualExp from the KI Infra
      // States/UTs table, which is money held by States, not by SAI's own
      // Regional Centres — it must not be folded into "unspent with RCs".
      rcUnutilised: d.source ? 0 : Math.max(0, limitAssigned - actualExp),
      // Every rupee of totalExp is either money drawn by a Regional Centre
      // against its limit, or spent directly by DDO KI without going through
      // one — the two always sum to the division's expenditure exactly.
      fromCentres: actualExp,
      fromDirect: directExp,
      components,
      // "Funded" = a target/assignment figure exists for this component (see
      // config.componentTargets — usually empty; see _componentTargetsNote).
      // Components counts as null (not zero) when no target data exists at
      // all, so a division with nothing filled in doesn't claim "0 funded".
      fundedCount: components.some(c => c.target != null) ? fundedComponents.length : null,
      noSpendCount: fundedComponents.filter(c => !c.hasSpend).length,
    };
  });

  for (const c of master.components) {
    if (!claimed.has(norm(c.name))) {
      warnings.push(`Component "${c.name}" is not mapped to any division — its ₹${(c.totalExp / 1e7).toFixed(2)} Cr is excluded from the division table.`);
    }
  }

  // --- Regional Centre utilisation, summed across every component ---
  // "Limit Assigned" here is money SAI has pushed OUT to the centre (a limit
  // on a bank account it controls); "Actual Exp." is what that centre has
  // actually drawn against that limit. DDO HQ is excluded — it is SAI's own
  // head office routing money onward, not a Regional Centre spending it.
  const rcNameByNorm = new Map((config.testSheet2.rcTabs || []).map(t => [norm(t), t]));
  // A dropped letter ("LUCNOW") doesn't normalise the same as the correct
  // spelling, so norm-matching alone can't fix it — needs an explicit map.
  const rcColumnAliases = new Map(
    Object.entries(config.testSheet2.rcColumnAliases || {}).map(([k, v]) => [norm(k), v])
  );
  const rcAcc = new Map();
  for (const c of master.components) {
    for (const [rawName, v] of Object.entries(c.byRc || {})) {
      const rawNorm = norm(rawName);
      if (rawNorm === 'ddohq' || rawNorm === 'infra') continue;   // not a Regional Centre
      const label = rcColumnAliases.get(rawNorm) || rcNameByNorm.get(rawNorm) || rawName;
      // Key by the corrected label, not the raw column name — so a typo that
      // gets fixed upstream later still lands in the same bucket as today's.
      const n = norm(label);
      if (!rcAcc.has(n)) rcAcc.set(n, { name: label, limitAssigned: 0, actualExp: 0 });
      const e = rcAcc.get(n);
      e.limitAssigned += v.limitAssigned;
      e.actualExp += v.actualExp;
    }
  }
  const regionalCentres = [...rcAcc.values()]
    .map(rc => ({
      ...rc,
      unspent: rc.limitAssigned - rc.actualExp,
      utilisation: rc.limitAssigned ? Math.round((rc.actualExp / rc.limitAssigned) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.limitAssigned - a.limitAssigned);
  const rcTotals = regionalCentres.reduce((a, rc) => ({
    limitAssigned: a.limitAssigned + rc.limitAssigned,
    actualExp: a.actualExp + rc.actualExp,
    unspent: a.unspent + rc.unspent,
  }), { limitAssigned: 0, actualExp: 0, unspent: 0 });

  const totals = divisions.reduce((a, d) => ({
    assigned: a.assigned + d.assigned,
    expenditure: a.expenditure + d.expenditure,
    balance: a.balance + d.balance,
    rcUnutilised: a.rcUnutilised + d.rcUnutilised,
  }), { assigned: 0, expenditure: 0, balance: 0, rcUnutilised: 0 });

  // --- the day's claims, classified ---
  const daily = dsc || rbi;
  const day = {
    date: daily ? daily.reportDate : null,
    time: daily ? daily.reportTime : null,
    fundTransferId: daily ? daily.fundTransferId : null,
    total: 0,
    byStream: { RC: 0, STATE: 0, INFRA_VENDOR: 0, DDO_KI: 0, UNKNOWN: 0 },
    agencies: [],
    unresolved: [],
  };

  if (daily) {
    if (daily.source === 'DSC_Details') {
      // Data directly from DSC_Details tab: already normalized and typed
      const acc = new Map();
      for (const c of daily.claims) {
        day.total += c.claimAmount;
        const stream = c.stream || 'RC';
        day.byStream[stream] = (day.byStream[stream] || 0) + c.claimAmount;

        const isDdoKi = stream === 'DDO_KI';
        const displayName = isDdoKi && c.component
          ? `DDO KI (${componentLabels[c.component] || c.component})`
          : c.childAgency;

        const key = `${c.type}::${c.childAgency}::${c.component || ''}`;
        if (!acc.has(key)) {
          acc.set(key, {
            key,
            type: c.type,
            stream,
            name: displayName,
            raw: c.childAgency,
            component: c.component || '',
            oldValue: c.oldValue,
            newValue: c.newValue,
            time: c.time || daily.reportTime || '',
            amount: 0,
            count: 0,
          });
        }
        const e = acc.get(key);
        e.amount += c.claimAmount;
        e.count++;
      }
      day.agencies = [...acc.values()].sort((a, b) => b.amount - a.amount);
    } else {
      // Legacy RBI report parser fallback
      const acc = new Map();
      for (const c of daily.claims || []) {
        const r = resolver ? resolver(c.childAgency) : { type: 'UNKNOWN', raw: c.childAgency };
        if (r.type === 'AGGREGATE') continue;  // a roll-up row in the export, not a payment
        if (r.type === 'UNKNOWN') day.unresolved.push(c.childAgency);

        day.total += c.claimAmount;
        day.byStream[r.type] = (day.byStream[r.type] || 0) + c.claimAmount;

        const key = r.type === 'RC' ? `RC:${r.tab}` : r.type === 'STATE' ? `STATE:${r.state}` : `${r.type}:${r.raw}`;
        if (!acc.has(key)) {
          acc.set(key, {
            key,
            type: r.type,
            stream: r.type,
            name: r.tab || r.state || r.raw,
            raw: r.raw,
            component: '',
            oldValue: null,
            newValue: null,
            time: daily.reportTime || '',
            amount: 0,
            count: 0,
          });
        }
        const e = acc.get(key);
        e.amount += c.claimAmount;
        e.count++;
      }
      day.agencies = [...acc.values()].sort((a, b) => b.amount - a.amount);
      day.unresolved = [...new Set(day.unresolved)];
      if (day.unresolved.length) {
        warnings.push(`${day.unresolved.length} agency name(s) in the RBI report did not match any Regional Centre, State or known construction agency: ${day.unresolved.slice(0, 8).join('; ')}${day.unresolved.length > 8 ? ' …' : ''}. Add them to "agencyAliases" in config/config.json.`);
      }
    }
  }

  return { divisions, totals, day, regionalCentres, rcTotals, warnings, master };
}

module.exports = { rollup };
