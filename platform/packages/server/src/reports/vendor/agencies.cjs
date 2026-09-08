'use strict';
const { norm } = require('./util.cjs');

/* Rows that are roll-ups, not agencies. */
const AGGREGATE = new Set(['alltotal', 'total', 'grandtotal', 'sumtotal', 'nettotal']);

/*
 * Name variants seen in real RBI exports that plain substring matching misses.
 * Left side is matched as a normalised substring of the agency name.
 */
const RC_HINTS = [
  ['lncpe', 'TRIVANDRUM'],
  ['thiruvananthapuram', 'TRIVANDRUM'],
  ['netajisubhash', 'LUCKNOW'],
  ['nsrc', 'LUCKNOW'],
  ['luknow', 'LUCKNOW'],
  ['udavdasmehta', 'BHOPAL'],
  ['bhopa', 'BHOPAL'],
  ['nssc', 'BANGALORE'],
  ['bengaluru', 'BANGALORE'],
  ['ddoheadoffice', 'DDO HQ'],
  ['ddohq', 'DDO HQ'],
  ['ddoki', 'DDO HQ'],
  ['nsnis', 'PATIALA'],
];

/* Construction / execution agencies — these are New Sports Infrastructure Projects spend. */
const INFRA_VENDOR_HINTS = [
  'wapcos', 'hscl', 'hindustansteelworks', 'nbcc', 'nationalbuildings',
  'upprojects', 'upstateconstruction', 'engineersindia', 'cpwd', 'nprojects',
  'constructioncorporation', 'infrastructuredevelopmentcorporation',
];

/**
 * Build a resolver.
 * @param {string[]} rcTabs   Test sheet 2 tab names (KOLKATA, PATIALA, ...)
 * @param {string[]} states   State/UT names from the KI Infra table
 * @param {object}   aliases  config.agencyAliases — exact-name overrides
 */
function createResolver(rcTabs, states, aliases = {}) {
  const aliasMap = new Map(Object.entries(aliases).map(([k, v]) => [norm(k), v]));
  // Longest first, so "ANDHRA PRADESH" wins over a shorter accidental match.
  const stateList = [...states].sort((a, b) => norm(b).length - norm(a).length);
  const rcList = [...rcTabs].sort((a, b) => norm(b).length - norm(a).length);

  return function resolve(rawName) {
    const raw = String(rawName || '').replace(/\s+/g, ' ').trim();
    const n = norm(raw);
    if (!n) return { type: 'UNKNOWN', raw };
    if (AGGREGATE.has(n)) return { type: 'AGGREGATE', raw };

    const alias = aliasMap.get(n);
    if (alias) return { type: 'RC', tab: alias, raw };

    // 1. Construction agency -> SAI infrastructure. Checked before the RC
    //    city-name match below: real vendor names embed a place name (seen in
    //    your own data — "UP PROJECTS CORPORATION LTD ... VARANASI", "Nashik
    //    Corporation (Maharashtra State)"), so a bare city-name substring
    //    check would misfile a vendor as that city's Regional Centre. A
    //    vendor keyword (wapcos, hscl, nbcc, ...) is specific enough that it
    //    would essentially never appear inside a genuine RC payment line, so
    //    it is the safer, more specific signal and wins first.
    for (const hint of INFRA_VENDOR_HINTS) {
      if (n.includes(hint)) return { type: 'INFRA_VENDOR', raw };
    }
    // 2. Regional Centre — direct tab-name containment.
    for (const tab of rcList) {
      if (n.includes(norm(tab))) return { type: 'RC', tab, raw };
    }
    // 3. Regional Centre — known variants.
    for (const [hint, tab] of RC_HINTS) {
      if (n.includes(hint)) return { type: 'RC', tab, raw };
    }
    // 4. State / UT -> MSD infrastructure.
    for (const st of stateList) {
      if (n.includes(norm(st))) return { type: 'STATE', state: st, raw };
    }
    // A bare "DDO ..." that matched nothing above still belongs to head office.
    if (n.startsWith('ddo')) return { type: 'RC', tab: 'DDO HQ', raw };

    return { type: 'UNKNOWN', raw };
  };
}

module.exports = { createResolver };
