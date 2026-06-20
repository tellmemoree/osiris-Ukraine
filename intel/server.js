/**
 * OSIRIS Intelligence Layer — osiris-intel
 *
 * Centralized ontology engine that ingests, indexes, and correlates entities
 * across open-source intelligence feeds. All other services query this one
 * brain via GET /resolve.
 *
 * Data sources:
 *   - OpenSanctions (OFAC SDN) — bulk CSV, refreshed every 24h
 *   - Wikidata SPARQL — on-demand with aggressive LRU cache
 *
 * Security:
 *   - Outbound requests only to allowlisted domains
 *   - SPARQL inputs sanitized against injection
 *   - Rate-limited per client IP
 */

const express = require('express');
const app = express();
const PORT = process.env.INTEL_PORT || 4000;

// ════════════════════════════════════════════════════
// §1 — CONFIGURATION
// ════════════════════════════════════════════════════

const SANCTIONS_SOURCES = [
  { url: 'https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv',      label: 'OFAC SDN' },
  { url: 'https://data.opensanctions.org/datasets/latest/eu_fsf/targets.simple.csv',           label: 'EU FSF'   },
  { url: 'https://data.opensanctions.org/datasets/latest/un_sc_sanctions/targets.simple.csv',  label: 'UN SC'    },
  { url: 'https://data.opensanctions.org/datasets/latest/gb_hmt_sanctions/targets.simple.csv', label: 'UK HMT'  },
];
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const WIKIDATA_UA = 'OSIRIS-Intel/1.0 (https://osirisai.live; ontology engine)';
const SDN_REFRESH_MS = 24 * 60 * 60 * 1000; // 24h
const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const WIKIDATA_CACHE_MAX = 10_000;

const SHODAN_API_KEY = process.env.SHODAN_API_KEY || '';
const ABUSEIPDB_KEY  = process.env.ABUSEIPDB_KEY  || '';

const ALLOWED_DOMAINS = new Set([
  'query.wikidata.org', 'data.opensanctions.org', 'www.wikidata.org',
  'ip-api.com', 'stat.ripe.net', 'api.opencorporates.com',
  'api.shodan.io', 'api.abuseipdb.com', 'registry.faa.gov',
]);

// ════════════════════════════════════════════════════
// §2 — SANCTIONS INDEX (in-memory graph)
// ════════════════════════════════════════════════════

let sanctionsIndex = {
  entries: [],
  byNorm: new Map(),   // normalised name/alias → [entry]
  fetchedAt: 0,
};

function normName(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseSanctionsRows(rows, label) {
  const headers = rows[0];
  const idx = (col) => headers.indexOf(col);
  const i = {
    id: idx('id'), schema: idx('schema'), name: idx('name'),
    aliases: idx('aliases'), countries: idx('countries'),
    programs: idx('program_ids'), sanctions: idx('sanctions'),
    first_seen: idx('first_seen'),
  };
  const entries = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[i.name]) continue;
    entries.push({
      id: row[i.id] || '',
      schema: row[i.schema] || 'LegalEntity',
      name: row[i.name],
      aliases: (row[i.aliases] || '').split(';').map(s => s.trim()).filter(Boolean),
      countries: (row[i.countries] || '').split(';').map(s => s.trim()).filter(Boolean),
      programs: (row[i.programs] || '').split(';').map(s => s.trim()).filter(Boolean),
      sanctions: row[i.sanctions] || '',
      first_seen: i.first_seen >= 0 ? row[i.first_seen] : undefined,
      sanctionsList: label,
    });
  }
  return entries;
}

async function loadSanctions() {
  console.log('[INTEL] Loading sanctions lists (OFAC SDN, EU FSF, UN SC, UK HMT)...');
  const results = await Promise.allSettled(
    SANCTIONS_SOURCES.map(async ({ url, label }) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'text/csv' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error('CSV empty');
      const entries = parseSanctionsRows(rows, label);
      console.log(`[INTEL] ${label}: ${entries.length} entities`);
      return entries;
    })
  );

  const allEntries = [];
  const byNorm = new Map();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const entry of r.value) {
        allEntries.push(entry);
        const keys = new Set([entry.name, ...entry.aliases].map(normName));
        for (const key of keys) {
          if (!key) continue;
          if (!byNorm.has(key)) byNorm.set(key, []);
          byNorm.get(key).push(entry);
        }
      }
    } else {
      console.error('[INTEL] Sanctions source failed:', r.reason?.message);
    }
  }

  if (allEntries.length === 0 && sanctionsIndex.entries.length > 0) {
    console.log('[INTEL] All sources failed — keeping stale index');
    return;
  }
  sanctionsIndex = { entries: allEntries, byNorm, fetchedAt: Date.now() };
  console.log(`[INTEL] Sanctions index: ${allEntries.length} entities across ${SANCTIONS_SOURCES.length} lists, ${byNorm.size} name keys`);
}

function sanctionsSearch(query, limit = 5) {
  if (!query || query.length < 3) return [];
  const q = normName(query);
  const exact = sanctionsIndex.byNorm.get(q) || [];
  if (exact.length > 0) return exact.slice(0, limit);

  const results = [];
  const seen = new Set();
  for (const entry of sanctionsIndex.entries) {
    if (results.length >= limit) break;
    if (seen.has(entry.id)) continue;
    const n = normName(entry.name);
    if (n.includes(q) || entry.aliases.some(a => normName(a).includes(q))) {
      seen.add(entry.id);
      results.push(entry);
    }
  }
  return results;
}

// ════════════════════════════════════════════════════
// §3 — WIKIDATA LRU CACHE
// ════════════════════════════════════════════════════

const wdCache = new Map(); // key → { data, ts }

function wdCacheGet(key) {
  const entry = wdCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > WIKIDATA_CACHE_TTL) { wdCache.delete(key); return null; }
  // Move to end (LRU)
  wdCache.delete(key);
  wdCache.set(key, entry);
  return entry.data;
}

function wdCacheSet(key, data) {
  if (wdCache.size >= WIKIDATA_CACHE_MAX) {
    const oldest = wdCache.keys().next().value;
    wdCache.delete(oldest);
  }
  wdCache.set(key, { data, ts: Date.now() });
}

// ════════════════════════════════════════════════════
// §4 — WIKIDATA SPARQL (safe)
// ════════════════════════════════════════════════════

function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9 \-._]/g, '').trim();
}

async function sparql(query) {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const parsed = new URL(url);
  if (!ALLOWED_DOMAINS.has(parsed.hostname)) {
    throw new Error(`Blocked domain: ${parsed.hostname}`);
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': WIKIDATA_UA, Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.results?.bindings || [];
}

// Search Wikidata for an entity by name, returns QID or null
async function wdSearch(query, type = 'item') {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=1&format=json`;
  const parsed = new URL(url);
  if (!ALLOWED_DOMAINS.has(parsed.hostname)) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKIDATA_UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.search?.[0]?.id || null;
  } catch { return null; }
}

// ════════════════════════════════════════════════════
// §5 — RESOLVERS (the intelligence)
// ════════════════════════════════════════════════════

function addSanctionsToGraph(query, rootId, nodes, links) {
  const matches = sanctionsSearch(query);
  for (const m of matches) {
    const sid = `sanction:${m.id}`;
    nodes.push({
      id: sid, label: `⚠ ${m.name}`, type: 'sanction',
      properties: {
        schema: m.schema, countries: m.countries.join(', '),
        programs: m.programs.join(', '), sanctions: m.sanctions,
        aliases: m.aliases.slice(0, 5).join('; '),
        first_seen: m.first_seen, sanctioned: true,
        sanctions_list: m.sanctionsList || 'OFAC SDN',
      },
    });
    links.push({ source: rootId, target: sid, label: 'SANCTIONS MATCH' });
  }
}

function dedup(nodes, links) {
  const seen = new Set();
  const uNodes = [];
  for (const n of nodes) { if (!seen.has(n.id)) { seen.add(n.id); uNodes.push(n); } }
  const lSeen = new Set();
  const uLinks = [];
  for (const l of links) {
    const k = `${l.source}→${l.target}→${l.label}`;
    if (!lSeen.has(k)) { lSeen.add(k); uLinks.push(l); }
  }
  return { nodes: uNodes, links: uLinks };
}

async function resolveAircraft(id, properties = {}) {
  const rootId = `aircraft:${id}`;
  const nodes = [], links = [];
  const cacheKey = `aircraft:${id}:${properties.registration || ''}`;
  const cached = wdCacheGet(cacheKey);
  if (cached) return { ...cached };

  const callsign = id.toUpperCase().trim();
  const registration = (properties.registration || '').toUpperCase().trim();
  const model = properties.model || '';

  // Step 1: Decode ICAO airline prefix from callsign (e.g. TRK → Turkish Airlines)
  // The prefix is the alphabetic portion of the callsign
  const airlinePrefix = callsign.replace(/[0-9]+$/, '');
  let airlineName = null;

  if (airlinePrefix && airlinePrefix.length >= 2) {
    // Search Wikidata for the ICAO airline code
    try {
      const results = await sparql(`
        SELECT ?item ?itemLabel ?countryLabel ?ceoLabel ?parentLabel WHERE {
          ?item wdt:P230 "${airlinePrefix}" .
          OPTIONAL { ?item wdt:P17 ?country . }
          OPTIONAL { ?item wdt:P169 ?ceo . }
          OPTIONAL { ?item wdt:P749 ?parent . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
        } LIMIT 5`);

      for (const r of results) {
        if (r.itemLabel?.value) {
          airlineName = r.itemLabel.value;
          const airId = `company:${airlineName}`;
          nodes.push({ id: airId, label: airlineName, type: 'company', properties: { icao_code: airlinePrefix, source: 'Wikidata' } });
          links.push({ source: rootId, target: airId, label: 'OPERATED BY' });

          if (r.countryLabel?.value) {
            const cid = `country:${r.countryLabel.value}`;
            nodes.push({ id: cid, label: r.countryLabel.value, type: 'country', properties: { source: 'Wikidata' } });
            links.push({ source: airId, target: cid, label: 'HEADQUARTERED' });
          }
          if (r.ceoLabel?.value) {
            const pid = `person:${r.ceoLabel.value}`;
            nodes.push({ id: pid, label: r.ceoLabel.value, type: 'person', properties: { role: 'CEO', source: 'Wikidata' } });
            links.push({ source: airId, target: pid, label: 'CEO' });
          }
          if (r.parentLabel?.value) {
            const pid = `company:${r.parentLabel.value}`;
            nodes.push({ id: pid, label: r.parentLabel.value, type: 'company', properties: { source: 'Wikidata' } });
            links.push({ source: airId, target: pid, label: 'PARENT ORG' });
          }
        }
      }
    } catch (e) { console.warn('[INTEL] Airline ICAO lookup error:', e.message); }
  }

  // Step 2: Decode registration prefix → country
  const REG_PREFIXES = {
    'N':'United States','G':'United Kingdom','F':'France','D':'Germany','I':'Italy',
    'JA':'Japan','HL':'South Korea','B':'China','VT':'India','TC':'Turkey',
    'RA':'Russia','UN':'Russia','UR':'Ukraine','A6':'UAE','A7':'Qatar','9V':'Singapore',
    'VH':'Australia','C':'Canada','PP':'Brazil','PR':'Brazil','PT':'Brazil',
    'EC':'Spain','HS':'Thailand','9M':'Malaysia','EP':'Iran','YI':'Iraq',
    'HZ':'Saudi Arabia','4X':'Israel','SX':'Greece','OE':'Austria','HB':'Switzerland',
    'SE':'Sweden','OH':'Finland','LN':'Norway','OY':'Denmark','PH':'Netherlands',
    'OO':'Belgium','CS':'Portugal','SP':'Poland','OK':'Czech Republic','HA':'Hungary',
    'YR':'Romania','LZ':'Bulgaria','EI':'Ireland','EW':'Belarus','ES':'Estonia',
    'YL':'Latvia','LY':'Lithuania','SU':'Egypt','AP':'Pakistan','CC':'Chile',
    'CN':'Morocco','CP':'Bolivia','CU':'Cuba','LV':'Argentina','LX':'Luxembourg',
    'OD':'Lebanon','P4':'Aruba','ST':'Sudan','TF':'Iceland','TJ':'Cameroon',
    'TL':'Central African Republic','TR':'Gabon','TS':'Tunisia','TT':'Chad',
    'TY':'Benin','TZ':'Mali','UK':'Uzbekistan','EK':'Armenia','EL':'Liberia',
    'EX':'Kyrgyzstan','EY':'Tajikistan','EZ':'Turkmenistan','S2':'Bangladesh',
    'XU':'Cambodia','XY':'Myanmar','ZK':'New Zealand','Z':'Zimbabwe',
    '4L':'Georgia','5A':'Libya','5N':'Nigeria','5T':'Mauritania','5X':'Uganda',
    '5Y':'Kenya','6V':'Senegal','7P':'Lesotho','7Q':'Malawi','7T':'Algeria',
    '9U':'Burundi','A2':'Botswana','9G':'Ghana','9J':'Zambia',
    'JU':'Mongolia','JY':'Jordan','OB':'Peru','RX':'Philippines','SY':'Greece',
  };

  if (registration) {
    let regCountry = null;
    if (REG_PREFIXES[registration.substring(0, 2)]) regCountry = REG_PREFIXES[registration.substring(0, 2)];
    else if (REG_PREFIXES[registration.substring(0, 1)]) regCountry = REG_PREFIXES[registration.substring(0, 1)];

    if (regCountry) {
      const cid = `country:${regCountry}`;
      nodes.push({ id: cid, label: regCountry, type: 'country', properties: { source: 'Registration prefix' } });
      links.push({ source: rootId, target: cid, label: 'REGISTERED IN' });
    }

    // FAA registry lookup for US N-number registrations
    if (registration.startsWith('N') && /^N\d/.test(registration)) {
      try {
        const faaUrl = `https://registry.faa.gov/api/1.0/aircraft/${encodeURIComponent(registration)}`;
        if (!ALLOWED_DOMAINS.has(new URL(faaUrl).hostname)) throw new Error('Blocked domain');
        const res = await fetch(faaUrl, { signal: AbortSignal.timeout(7000), headers: { Accept: 'application/json' } });
        if (res.ok) {
          const d = await res.json();
          if (d.manufacturer || d.name) {
            const ownerId = `company:${d.name || d.manufacturer}`;
            nodes.push({
              id: ownerId, label: d.name || d.manufacturer, type: 'company',
              properties: { manufacturer: d.manufacturer, model: d.model, year: d.year_mfr, engine: d.engine_type, source: 'FAA Registry' },
            });
            links.push({ source: rootId, target: ownerId, label: 'REGISTERED OWNER' });
          }
        }
      } catch (e) { console.warn('[INTEL] FAA registry error:', e.message); }
    }
  }

  // Step 3: Add aircraft model info
  if (model) {
    const mid = `aircraft:model:${model}`;
    nodes.push({ id: mid, label: model, type: 'aircraft', properties: { type: 'model', source: 'ADS-B' } });
    links.push({ source: rootId, target: mid, label: 'AIRCRAFT TYPE' });
  }

  // Step 4: Cross-ref sanctions on airline name + callsign
  addSanctionsToGraph(callsign, rootId, nodes, links);
  if (airlineName) addSanctionsToGraph(airlineName, rootId, nodes, links);
  if (registration) addSanctionsToGraph(registration, rootId, nodes, links);

  const result = dedup(nodes, links);
  wdCacheSet(cacheKey, result);
  return result;
}

async function resolveVessel(id) {
  const rootId = `vessel:${id}`;
  const nodes = [], links = [];
  const cached = wdCacheGet(`vessel:${id}`);
  if (cached) return { ...cached };

  try {
    // wdSearch() is unconstrained and conflates vessel names with same-named cities/places.
    // Use ship-typed SPARQL directly: IMO number (P458) or label constrained to ship class (Q11446).
    const sid = sanitizeId(id);
    const filter = `{ ?item wdt:P458 "${sid}" . } UNION { ?item rdfs:label "${sid}"@en . ?item wdt:P31/wdt:P279* wd:Q11446 . } UNION { ?item skos:altLabel "${sid}"@en . ?item wdt:P31/wdt:P279* wd:Q11446 . }`;

    const results = await sparql(`
      SELECT ?item ?itemLabel ?ownerLabel ?countryLabel ?operatorLabel ?flagLabel
             ?imoNumber ?grossTonnage ?builtYear ?vesselTypeLabel WHERE {
        ${filter}
        OPTIONAL { ?item wdt:P127 ?owner . }
        OPTIONAL { ?item wdt:P17 ?country . }
        OPTIONAL { ?item wdt:P137 ?operator . }
        OPTIONAL { ?item wdt:P8047 ?flag . }
        OPTIONAL { ?item wdt:P458 ?imoNumber . }
        OPTIONAL { ?item wdt:P1093 ?grossTonnage . }
        OPTIONAL { ?item wdt:P571 ?builtYear . }
        OPTIONAL { ?item wdt:P31 ?vesselType . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 10`);

    let vesselPropsSet = false;
    for (const r of results) {
      if (!vesselPropsSet) {
        const props = { source: 'Wikidata' };
        if (r.imoNumber?.value)    props.imo           = r.imoNumber.value;
        if (r.grossTonnage?.value) props.gross_tonnage = r.grossTonnage.value;
        if (r.builtYear?.value)    props.year_built    = r.builtYear.value.substring(0, 4);
        if (r.vesselTypeLabel?.value) props.vessel_type = r.vesselTypeLabel.value;
        nodes.push({ id: rootId, label: id, type: 'vessel', properties: props });
        vesselPropsSet = true;
      }
      if (r.ownerLabel?.value) {
        const oid = `company:${r.ownerLabel.value}`;
        nodes.push({ id: oid, label: r.ownerLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: oid, label: 'OWNED BY' });
      }
      const flag = r.flagLabel?.value || r.countryLabel?.value;
      if (flag) {
        const cid = `country:${flag}`;
        nodes.push({ id: cid, label: flag, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: cid, label: 'FLAG STATE' });
      }
      if (r.operatorLabel?.value) {
        const oid = `company:${r.operatorLabel.value}`;
        nodes.push({ id: oid, label: r.operatorLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: oid, label: 'OPERATED BY' });
      }
    }
  } catch (e) { console.warn('[INTEL] Wikidata vessel error:', e.message); }

  addSanctionsToGraph(id, rootId, nodes, links);
  const result = dedup(nodes, links);
  wdCacheSet(`vessel:${id}`, result);
  return result;
}

async function resolveCompany(id) {
  const rootId = `company:${id}`;
  const nodes = [], links = [];
  const cached = wdCacheGet(`company:${id}`);
  if (cached) return { ...cached };

  try {
    // Use Wikidata search to find the QID first, then resolve by QID
    const qid = await wdSearch(id);
    const filter = qid
      ? `VALUES ?item { wd:${qid} }`
      : `?item rdfs:label "${id}"@en . { ?item wdt:P31/wdt:P279* wd:Q4830453 . } UNION { ?item wdt:P31/wdt:P279* wd:Q43229 . }`;
    const results = await sparql(`
      SELECT ?item ?itemLabel ?countryLabel ?parentLabel ?ceoLabel ?industryLabel WHERE {
        ${filter}
        OPTIONAL { ?item wdt:P17 ?country . }
        OPTIONAL { ?item wdt:P749 ?parent . }
        OPTIONAL { ?item wdt:P169 ?ceo . }
        OPTIONAL { ?item wdt:P452 ?industry . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 10`);
    for (const r of results) {
      if (r.countryLabel?.value) {
        const cid = `country:${r.countryLabel.value}`;
        nodes.push({ id: cid, label: r.countryLabel.value, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: cid, label: 'HEADQUARTERED' });
      }
      if (r.parentLabel?.value) {
        const pid = `company:${r.parentLabel.value}`;
        nodes.push({ id: pid, label: r.parentLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: pid, label: 'PARENT ORG' });
      }
      if (r.ceoLabel?.value) {
        const pid = `person:${r.ceoLabel.value}`;
        nodes.push({ id: pid, label: r.ceoLabel.value, type: 'person', properties: { role: 'CEO', source: 'Wikidata' } });
        links.push({ source: rootId, target: pid, label: 'CEO' });
      }
    }
  } catch (e) { console.warn('[INTEL] Wikidata company error:', e.message); }

  // OpenCorporates — 500 req/day free tier, no key needed
  try {
    const ocUrl = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(id)}&format=json&per_page=1`;
    if (!ALLOWED_DOMAINS.has(new URL(ocUrl).hostname)) throw new Error('Blocked domain');
    const res = await fetch(ocUrl, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': WIKIDATA_UA } });
    if (res.ok) {
      const json = await res.json();
      const co = json.results?.companies?.[0]?.company;
      if (co) {
        nodes.push({
          id: rootId, label: id, type: 'company',
          properties: {
            jurisdiction: co.jurisdiction_code,
            company_number: co.company_number,
            company_type: co.company_type,
            status: co.current_status,
            incorporation_date: co.incorporation_date,
            registered_address: co.registered_address_in_full,
            source: 'OpenCorporates',
          },
        });
        for (const o of (co.officers || []).slice(0, 5)) {
          const off = o.officer;
          if (!off?.name) continue;
          const pid = `person:${off.name}`;
          nodes.push({ id: pid, label: off.name, type: 'person', properties: { role: off.position || 'Officer', source: 'OpenCorporates' } });
          links.push({ source: rootId, target: pid, label: (off.position || 'OFFICER').toUpperCase() });
        }
      }
    }
  } catch (e) { console.warn('[INTEL] OpenCorporates error:', e.message); }

  addSanctionsToGraph(id, rootId, nodes, links);
  const result = dedup(nodes, links);
  wdCacheSet(`company:${id}`, result);
  return result;
}

async function resolvePerson(id) {
  const rootId = `person:${id}`;
  const nodes = [], links = [];
  const cached = wdCacheGet(`person:${id}`);
  if (cached) return { ...cached };

  try {
    const qid = await wdSearch(id);
    const filter = qid
      ? `VALUES ?item { wd:${qid} }`
      : `?item rdfs:label "${id}"@en . ?item wdt:P31 wd:Q5 .`;
    const results = await sparql(`
      SELECT ?item ?itemLabel ?nationalityLabel ?employerLabel ?positionLabel WHERE {
        ${filter}
        OPTIONAL { ?item wdt:P27 ?nationality . }
        OPTIONAL { ?item wdt:P108 ?employer . }
        OPTIONAL { ?item wdt:P39 ?position . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 10`);
    for (const r of results) {
      if (r.nationalityLabel?.value) {
        const cid = `country:${r.nationalityLabel.value}`;
        nodes.push({ id: cid, label: r.nationalityLabel.value, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: cid, label: 'NATIONALITY' });
      }
      if (r.employerLabel?.value) {
        const eid = `company:${r.employerLabel.value}`;
        nodes.push({ id: eid, label: r.employerLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: eid, label: 'EMPLOYER' });
      }
      if (r.positionLabel?.value) {
        const pid = `event:${r.positionLabel.value}`;
        nodes.push({ id: pid, label: r.positionLabel.value, type: 'event', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: pid, label: 'POSITION HELD' });
      }
    }
  } catch (e) { console.warn('[INTEL] Wikidata person error:', e.message); }

  addSanctionsToGraph(id, rootId, nodes, links);
  const result = dedup(nodes, links);
  wdCacheSet(`person:${id}`, result);
  return result;
}

async function resolveIP(id) {
  const rootId = `ip:${id}`;
  const nodes = [], links = [];
  const cached = wdCacheGet(`ip:${id}`);
  if (cached) return { ...cached };

  // Step 1: ip-api.com — geolocation, ISP, ASN, proxy/hosting detection
  try {
    const ipApiUrl = `http://ip-api.com/json/${encodeURIComponent(id)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting`;
    const parsed = new URL(ipApiUrl);
    if (!ALLOWED_DOMAINS.has(parsed.hostname)) throw new Error(`Blocked domain: ${parsed.hostname}`);
    const res = await fetch(ipApiUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        // ISP node
        if (data.isp) {
          const ispId = `company:${data.isp}`;
          nodes.push({ id: ispId, label: data.isp, type: 'company', properties: { role: 'ISP', org: data.org || '', source: 'ip-api.com' } });
          links.push({ source: rootId, target: ispId, label: 'HOSTED_BY' });
          addSanctionsToGraph(data.isp, rootId, nodes, links);
        }

        // ASN node
        if (data.as) {
          const asLabel = data.asname || data.as;
          const asId = `company:${data.as}`;
          nodes.push({ id: asId, label: asLabel, type: 'company', properties: { as_number: data.as, source: 'ip-api.com' } });
          links.push({ source: rootId, target: asId, label: 'ASN' });
        }

        // Country node
        if (data.country) {
          const cid = `country:${data.country}`;
          nodes.push({ id: cid, label: data.country, type: 'country', properties: { code: data.countryCode || '', source: 'ip-api.com' } });
          links.push({ source: rootId, target: cid, label: 'LOCATED_IN' });
          addSanctionsToGraph(data.country, rootId, nodes, links);
        }

        // City node (as event type with lat/lng)
        if (data.city) {
          const cityId = `event:${data.city}`;
          nodes.push({
            id: cityId, label: data.city, type: 'event',
            properties: {
              lat: data.lat, lon: data.lon, region: data.regionName || '',
              zip: data.zip || '', timezone: data.timezone || '', source: 'ip-api.com',
            },
          });
          links.push({ source: rootId, target: cityId, label: 'GEOLOCATED' });
        }

        // Tag proxy/hosting/mobile flags on the root IP node
        nodes.push({
          id: rootId, label: id, type: 'ip',
          properties: {
            proxy: !!data.proxy, hosting: !!data.hosting, mobile: !!data.mobile,
            source: 'ip-api.com',
          },
        });
      }
    }
  } catch (e) { console.warn('[INTEL] ip-api.com error:', e.message); }

  // Step 2: RIPEstat WHOIS
  try {
    const whoisUrl = `https://stat.ripe.net/data/whois/data.json?resource=${encodeURIComponent(id)}`;
    const parsed = new URL(whoisUrl);
    if (!ALLOWED_DOMAINS.has(parsed.hostname)) throw new Error(`Blocked domain: ${parsed.hostname}`);
    const res = await fetch(whoisUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = await res.json();
      const records = json.data?.records || [];
      for (const record of records) {
        for (const field of record) {
          if (field.key === 'netname' || field.key === 'NetName') {
            const netId = `company:${field.value}`;
            nodes.push({ id: netId, label: field.value, type: 'company', properties: { role: 'Network', source: 'RIPEstat WHOIS' } });
            links.push({ source: rootId, target: netId, label: 'HOSTED_BY' });
          }
        }
      }
    }
  } catch (e) { console.warn('[INTEL] RIPEstat WHOIS error:', e.message); }

  // Step 3: RIPEstat Abuse Contact
  try {
    const abuseUrl = `https://stat.ripe.net/data/abuse-contact-finder/data.json?resource=${encodeURIComponent(id)}`;
    const parsed = new URL(abuseUrl);
    if (!ALLOWED_DOMAINS.has(parsed.hostname)) throw new Error(`Blocked domain: ${parsed.hostname}`);
    const res = await fetch(abuseUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = await res.json();
      const contacts = json.data?.abuse_contacts || [];
      for (const email of contacts) {
        if (email) {
          const eid = `person:${email}`;
          nodes.push({ id: eid, label: email, type: 'person', properties: { role: 'Abuse Contact', source: 'RIPEstat' } });
          links.push({ source: rootId, target: eid, label: 'ABUSE CONTACT' });
        }
      }
    }
  } catch (e) { console.warn('[INTEL] RIPEstat abuse-contact error:', e.message); }

  // Step 4: RIPEstat Network Info
  try {
    const netUrl = `https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(id)}`;
    const parsed = new URL(netUrl);
    if (!ALLOWED_DOMAINS.has(parsed.hostname)) throw new Error(`Blocked domain: ${parsed.hostname}`);
    const res = await fetch(netUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = await res.json();
      const prefix = json.data?.prefix;
      const asns = json.data?.asns || [];
      if (prefix) {
        const prefId = `ip:${prefix}`;
        nodes.push({ id: prefId, label: prefix, type: 'ip', properties: { role: 'Prefix', source: 'RIPEstat' } });
        links.push({ source: rootId, target: prefId, label: 'PREFIX' });
      }
      for (const asn of asns) {
        const asnId = `company:AS${asn}`;
        nodes.push({ id: asnId, label: `AS${asn}`, type: 'company', properties: { as_number: `AS${asn}`, source: 'RIPEstat' } });
        links.push({ source: rootId, target: asnId, label: 'ASN' });
      }
    }
  } catch (e) { console.warn('[INTEL] RIPEstat network-info error:', e.message); }

  // Step 5: Shodan host intelligence
  if (SHODAN_API_KEY) {
    try {
      const shodanUrl = `https://api.shodan.io/shodan/host/${encodeURIComponent(id)}?key=${SHODAN_API_KEY}`;
      if (!ALLOWED_DOMAINS.has(new URL(shodanUrl).hostname)) throw new Error('Blocked domain');
      const res = await fetch(shodanUrl, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        const d = await res.json();
        if (d.ports?.length > 0) {
          const services = [...new Set((d.data || []).map(b => b.product).filter(Boolean))].slice(0, 6).join(', ');
          const portId = `event:ports:${id}`;
          nodes.push({
            id: portId, label: `Open ports: ${d.ports.slice(0, 8).join(', ')}${d.ports.length > 8 ? '…' : ''}`,
            type: 'event',
            properties: { ports: d.ports.join(', '), services: services || undefined, hostnames: (d.hostnames || []).join(', ') || undefined, source: 'Shodan' },
          });
          links.push({ source: rootId, target: portId, label: 'OPEN PORTS' });
        }
        if (d.vulns && Object.keys(d.vulns).length > 0) {
          const topVuln = Object.entries(d.vulns).sort((a, b) => (b[1].cvss || 0) - (a[1].cvss || 0))[0];
          const vulnId = `event:vuln:${topVuln[0]}`;
          nodes.push({
            id: vulnId, label: topVuln[0], type: 'event',
            properties: { cvss: topVuln[1].cvss, description: (topVuln[1].summary || '').slice(0, 120), source: 'Shodan' },
          });
          links.push({ source: rootId, target: vulnId, label: `VULNERABLE (${Object.keys(d.vulns).length} CVEs)` });
        }
        if (d.tags?.length > 0) {
          nodes.push({ id: rootId, label: id, type: 'ip', properties: { shodan_tags: d.tags.join(', '), source: 'Shodan' } });
        }
      }
    } catch (e) { console.warn('[INTEL] Shodan error:', e.message); }
  }

  // Step 6: AbuseIPDB reputation
  if (ABUSEIPDB_KEY) {
    try {
      const abuseUrl = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(id)}&maxAgeInDays=90`;
      if (!ALLOWED_DOMAINS.has(new URL(abuseUrl).hostname)) throw new Error('Blocked domain');
      const res = await fetch(abuseUrl, {
        signal: AbortSignal.timeout(6000),
        headers: { Key: ABUSEIPDB_KEY, Accept: 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        if (d?.abuseConfidenceScore > 0) {
          const abuseId = `event:abuse:${id}`;
          nodes.push({
            id: abuseId, label: `Abuse score: ${d.abuseConfidenceScore}%`, type: 'event',
            properties: { score: d.abuseConfidenceScore, reports: d.totalReports, last_reported: d.lastReportedAt, usage_type: d.usageType, source: 'AbuseIPDB' },
          });
          links.push({ source: rootId, target: abuseId, label: d.abuseConfidenceScore >= 50 ? 'HIGH ABUSE RISK' : 'ABUSE REPORTS' });
        }
      }
    } catch (e) { console.warn('[INTEL] AbuseIPDB error:', e.message); }
  }

  const result = dedup(nodes, links);
  wdCacheSet(`ip:${id}`, result);
  return result;
}

async function resolveCountry(id) {
  const rootId = `country:${id}`;
  const nodes = [], links = [];
  const cached = wdCacheGet(`country:${id}`);
  if (cached) return { ...cached };

  try {
    const qid = await wdSearch(id);
    const filter = qid
      ? `VALUES ?item { wd:${qid} }`
      : `?item rdfs:label "${id}"@en . ?item wdt:P31 wd:Q6256 .`;
    const results = await sparql(`
      SELECT ?item ?itemLabel ?headLabel ?capitalLabel ?population ?gdp
             ?tld ?callingCode ?memberOfLabel ?neighborLabel WHERE {
        ${filter}
        OPTIONAL { ?item wdt:P35 ?head . }
        OPTIONAL { ?item wdt:P36 ?capital . }
        OPTIONAL { ?item wdt:P1082 ?population . }
        OPTIONAL { ?item wdt:P2131 ?gdp . }
        OPTIONAL { ?item wdt:P78 ?tld . }
        OPTIONAL { ?item wdt:P474 ?callingCode . }
        OPTIONAL { ?item wdt:P463 ?memberOf . }
        OPTIONAL { ?item wdt:P47 ?neighbor . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 50`);

    const seenHeads = new Set();
    const seenMembers = new Set();
    const seenNeighbors = new Set();
    let propsSet = false;

    for (const r of results) {
      // Head of state/government
      if (r.headLabel?.value && !seenHeads.has(r.headLabel.value)) {
        seenHeads.add(r.headLabel.value);
        const hid = `person:${r.headLabel.value}`;
        nodes.push({ id: hid, label: r.headLabel.value, type: 'person', properties: { role: 'Head of State', source: 'Wikidata' } });
        links.push({ source: rootId, target: hid, label: 'HEAD OF STATE' });
      }

      // Capital city
      if (r.capitalLabel?.value && !propsSet) {
        const capId = `event:${r.capitalLabel.value}`;
        nodes.push({ id: capId, label: r.capitalLabel.value, type: 'event', properties: { role: 'Capital', source: 'Wikidata' } });
        links.push({ source: rootId, target: capId, label: 'CAPITAL' });
      }

      // Country properties (population, GDP, TLD, calling code)
      if (!propsSet) {
        const props = { source: 'Wikidata' };
        if (r.population?.value) props.population = r.population.value;
        if (r.gdp?.value) props.gdp = r.gdp.value;
        if (r.tld?.value) props.tld = r.tld.value;
        if (r.callingCode?.value) props.calling_code = r.callingCode.value;
        nodes.push({ id: rootId, label: id, type: 'country', properties: props });
        propsSet = true;
      }

      // Member of (UN, NATO, EU, etc.)
      if (r.memberOfLabel?.value && !seenMembers.has(r.memberOfLabel.value)) {
        seenMembers.add(r.memberOfLabel.value);
        const mid = `company:${r.memberOfLabel.value}`;
        nodes.push({ id: mid, label: r.memberOfLabel.value, type: 'company', properties: { role: 'Organization', source: 'Wikidata' } });
        links.push({ source: rootId, target: mid, label: 'MEMBER OF' });
      }

      // Neighboring countries
      if (r.neighborLabel?.value && !seenNeighbors.has(r.neighborLabel.value)) {
        seenNeighbors.add(r.neighborLabel.value);
        const nid = `country:${r.neighborLabel.value}`;
        nodes.push({ id: nid, label: r.neighborLabel.value, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: nid, label: 'NEIGHBOR' });
      }
    }
  } catch (e) { console.warn('[INTEL] Wikidata country error:', e.message); }

  addSanctionsToGraph(id, rootId, nodes, links);
  const result = dedup(nodes, links);
  wdCacheSet(`country:${id}`, result);
  return result;
}

const RESOLVERS = { aircraft: resolveAircraft, vessel: resolveVessel, company: resolveCompany, person: resolvePerson, ip: resolveIP, country: resolveCountry };
const ALLOWED_TYPES = new Set(Object.keys(RESOLVERS));

// ════════════════════════════════════════════════════
// §6 — RATE LIMITER
// ════════════════════════════════════════════════════

const rateMap = new Map();

function isRateLimited(ip, limit = 30, windowMs = 60000) {
  const now = Date.now();
  for (const [k, v] of rateMap) { if (now > v.resetAt) rateMap.delete(k); }
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) { rateMap.set(ip, { count: 1, resetAt: now + windowMs }); return false; }
  entry.count++;
  return entry.count > limit;
}

// ════════════════════════════════════════════════════
// §7 — EXPRESS ROUTES
// ════════════════════════════════════════════════════

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    sanctions_entries: sanctionsIndex.entries.length,
    sanctions_loaded_at: sanctionsIndex.fetchedAt ? new Date(sanctionsIndex.fetchedAt).toISOString() : null,
    wikidata_cache_size: wdCache.size,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

app.get('/resolve', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Rate limit exceeded' });

  const type = (req.query.type || '').toLowerCase().trim();
  const rawId = (req.query.id || '').trim();

  if (!type || !ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid type. Allowed: ${[...ALLOWED_TYPES].join(', ')}` });
  }
  if (!rawId || rawId.length < 2 || rawId.length > 200) {
    return res.status(400).json({ error: 'Invalid id (2-200 chars)' });
  }

  const id = sanitizeId(rawId);
  if (id.length < 2) return res.status(400).json({ error: 'ID contains too many invalid characters' });

  try {
    const resolver = RESOLVERS[type];
    // Pass extra properties for aircraft resolution (registration, model, etc.)
    const props = {};
    if (req.query.registration) props.registration = sanitizeId(req.query.registration);
    if (req.query.model) props.model = sanitizeId(req.query.model);
    if (req.query.icao24) props.icao24 = sanitizeId(req.query.icao24);
    const result = await resolver(id, props);
    res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    res.json({
      nodes: result.nodes,
      links: result.links,
      entity: { type, id },
      source: 'OSIRIS Intelligence Layer',
      sanctions_index_size: sanctionsIndex.entries.length,
      wikidata_cache_hits: wdCache.size,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[INTEL] Resolve error:', e);
    res.status(500).json({ error: 'Resolution failed', nodes: [], links: [] });
  }
});

// ════════════════════════════════════════════════════
// §8 — STARTUP
// ════════════════════════════════════════════════════

async function boot() {
  console.log('[INTEL] OSIRIS Intelligence Layer starting...');
  await loadSanctions();
  // Refresh sanctions every 24h
  setInterval(() => loadSanctions(), SDN_REFRESH_MS);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[INTEL] Intelligence Layer ready on port ${PORT}`);
    console.log(`[INTEL] Sanctions: ${sanctionsIndex.entries.length} entities indexed`);
    console.log(`[INTEL] Resolve endpoint: GET /resolve?type=<type>&id=<id>`);
  });
}

boot().catch(e => { console.error('[INTEL] Fatal:', e); process.exit(1); });
