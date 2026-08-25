/**
 * Location Detection Module
 *
 * Detects geographic location from V2Ray config fragments/hostnames.
 * Fully synchronous — no network calls, no dependencies.
 *
 * Priority chain:
 * 1. Fragment/remark from URI (#🇩🇪 Germany, #DE-Frankfurt)
 * 2. Hostname ccTLD (.de → DE, .ir → IR)
 * 3. Hostname prefix pattern (de-de1.server.com → DE)
 * 4. Source channel name match
 * 5. Fallback → "Unknown"
 */

// ─── Types ─────────────────────────────────────────────────

export interface LocationResult {
  /** Full country name (e.g. "Germany"). */
  country: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "DE"). */
  countryCode: string;
  /** Flag emoji for the country (e.g. "🇩🇪"). */
  flag: string;
  /** Display string (e.g. "🇩🇪 Germany"). */
  display: string;
  /** Confidence level of detection. */
  confidence: "high" | "medium" | "low" | "none";
}

// ─── Country Table ─────────────────────────────────────────

/** Map of country code to { country name, flag emoji }. */
const COUNTRY_MAP: Record<string, { country: string; flag: string }> = {
  AF: { country: "Afghanistan", flag: "\u{1F1E6}\u{1F1EB}" },
  AL: { country: "Albania", flag: "\u{1F1E6}\u{1F1F1}" },
  DZ: { country: "Algeria", flag: "\u{1F1E9}\u{1F1FF}" },
  AR: { country: "Argentina", flag: "\u{1F1E6}\u{1F1F7}" },
  AM: { country: "Armenia", flag: "\u{1F1E6}\u{1F1F2}" },
  AU: { country: "Australia", flag: "\u{1F1E6}\u{1F1FA}" },
  AT: { country: "Austria", flag: "\u{1F1E6}\u{1F1F9}" },
  AZ: { country: "Azerbaijan", flag: "\u{1F1E6}\u{1F1FF}" },
  BD: { country: "Bangladesh", flag: "\u{1F1E7}\u{1F1E9}" },
  BY: { country: "Belarus", flag: "\u{1F1E7}\u{1F1FE}" },
  BE: { country: "Belgium", flag: "\u{1F1E7}\u{1F1EA}" },
  BR: { country: "Brazil", flag: "\u{1F1E7}\u{1F1F7}" },
  BG: { country: "Bulgaria", flag: "\u{1F1E7}\u{1F1EC}" },
  KH: { country: "Cambodia", flag: "\u{1F1F0}\u{1F1ED}" },
  CA: { country: "Canada", flag: "\u{1F1E8}\u{1F1E6}" },
  CL: { country: "Chile", flag: "\u{1F1E8}\u{1F1F1}" },
  CN: { country: "China", flag: "\u{1F1E8}\u{1F1F3}" },
  CO: { country: "Colombia", flag: "\u{1F1E8}\u{1F1F4}" },
  HR: { country: "Croatia", flag: "\u{1F1ED}\u{1F1F7}" },
  CY: { country: "Cyprus", flag: "\u{1F1E8}\u{1F1FE}" },
  CZ: { country: "Czechia", flag: "\u{1F1E8}\u{1F1FF}" },
  DK: { country: "Denmark", flag: "\u{1F1E9}\u{1F1F0}" },
  EE: { country: "Estonia", flag: "\u{1F1EA}\u{1F1EA}" },
  FI: { country: "Finland", flag: "\u{1F1EB}\u{1F1EE}" },
  FR: { country: "France", flag: "\u{1F1EB}\u{1F1F7}" },
  GE: { country: "Georgia", flag: "\u{1F1EC}\u{1F1EA}" },
  DE: { country: "Germany", flag: "\u{1F1E9}\u{1F1EA}" },
  GR: { country: "Greece", flag: "\u{1F1EC}\u{1F1F7}" },
  HK: { country: "Hong Kong", flag: "\u{1F1ED}\u{1F1F0}" },
  HU: { country: "Hungary", flag: "\u{1F1ED}\u{1F1FA}" },
  IN: { country: "India", flag: "\u{1F1EE}\u{1F1F3}" },
  ID: { country: "Indonesia", flag: "\u{1F1EE}\u{1F1E9}" },
  IR: { country: "Iran", flag: "\u{1F1EE}\u{1F1F7}" },
  IQ: { country: "Iraq", flag: "\u{1F1EE}\u{1F1F6}" },
  IE: { country: "Ireland", flag: "\u{1F1EE}\u{1F1EA}" },
  IL: { country: "Israel", flag: "\u{1F1EE}\u{1F1F1}" },
  IT: { country: "Italy", flag: "\u{1F1EE}\u{1F1F9}" },
  JP: { country: "Japan", flag: "\u{1F1EF}\u{1F1F5}" },
  JO: { country: "Jordan", flag: "\u{1F1EF}\u{1F1F4}" },
  KZ: { country: "Kazakhstan", flag: "\u{1F1F0}\u{1F1FF}" },
  KE: { country: "Kenya", flag: "\u{1F1F0}\u{1F1EA}" },
  KR: { country: "South Korea", flag: "\u{1F1F0}\u{1F1F7}" },
  KW: { country: "Kuwait", flag: "\u{1F1F0}\u{1F1FC}" },
  KG: { country: "Kyrgyzstan", flag: "\u{1F1F0}\u{1F1EC}" },
  LV: { country: "Latvia", flag: "\u{1F1F1}\u{1F1FB}" },
  LT: { country: "Lithuania", flag: "\u{1F1F1}\u{1F1F9}" },
  LU: { country: "Luxembourg", flag: "\u{1F1F1}\u{1F1FA}" },
  MO: { country: "Macau", flag: "\u{1F1F2}\u{1F1F4}" },
  MY: { country: "Malaysia", flag: "\u{1F1F2}\u{1F1FE}" },
  MX: { country: "Mexico", flag: "\u{1F1F2}\u{1F1FD}" },
  MD: { country: "Moldova", flag: "\u{1F1F2}\u{1F1E9}" },
  MN: { country: "Mongolia", flag: "\u{1F1F2}\u{1F1F3}" },
  NL: { country: "Netherlands", flag: "\u{1F1F3}\u{1F1F1}" },
  NZ: { country: "New Zealand", flag: "\u{1F1F3}\u{1F1FF}" },
  NG: { country: "Nigeria", flag: "\u{1F1F3}\u{1F1EC}" },
  MK: { country: "North Macedonia", flag: "\u{1F1F2}\u{1F1F0}" },
  NO: { country: "Norway", flag: "\u{1F1F3}\u{1F1F4}" },
  PK: { country: "Pakistan", flag: "\u{1F1F5}\u{1F1F0}" },
  PA: { country: "Panama", flag: "\u{1F1F5}\u{1F1E6}" },
  PH: { country: "Philippines", flag: "\u{1F1F5}\u{1F1ED}" },
  PL: { country: "Poland", flag: "\u{1F1F5}\u{1F1F1}" },
  PT: { country: "Portugal", flag: "\u{1F1F5}\u{1F1F9}" },
  QA: { country: "Qatar", flag: "\u{1F1F6}\u{1F1E6}" },
  RO: { country: "Romania", flag: "\u{1F1F7}\u{1F1F4}" },
  RU: { country: "Russia", flag: "\u{1F1F7}\u{1F1FA}" },
  SA: { country: "Saudi Arabia", flag: "\u{1F1F8}\u{1F1E6}" },
  RS: { country: "Serbia", flag: "\u{1F1F7}\u{1F1F8}" },
  SG: { country: "Singapore", flag: "\u{1F1F8}\u{1F1EC}" },
  SK: { country: "Slovakia", flag: "\u{1F1F8}\u{1F1F0}" },
  SI: { country: "Slovenia", flag: "\u{1F1F8}\u{1F1EE}" },
  ZA: { country: "South Africa", flag: "\u{1F1FF}\u{1F1E6}" },
  ES: { country: "Spain", flag: "\u{1F1EA}\u{1F1F8}" },
  SE: { country: "Sweden", flag: "\u{1F1F8}\u{1F1EA}" },
  CH: { country: "Switzerland", flag: "\u{1F1E8}\u{1F1ED}" },
  TW: { country: "Taiwan", flag: "\u{1F1F9}\u{1F1FC}" },
  TH: { country: "Thailand", flag: "\u{1F1F9}\u{1F1ED}" },
  TR: { country: "Turkey", flag: "\u{1F1F9}\u{1F1F7}" },
  UA: { country: "Ukraine", flag: "\u{1F1FA}\u{1F1E6}" },
  AE: { country: "UAE", flag: "\u{1F1E6}\u{1F1EA}" },
  GB: { country: "United Kingdom", flag: "\u{1F1EC}\u{1F1E7}" },
  US: { country: "United States", flag: "\u{1F1FA}\u{1F1F8}" },
  UZ: { country: "Uzbekistan", flag: "\u{1F1FA}\u{1F1FF}" },
  VN: { country: "Vietnam", flag: "\u{1F1FB}\u{1F1F3}" },
};

// Reverse map: country name (lowercase) to code
const NAME_TO_CODE: Record<string, string> = {};
for (const [code, { country }] of Object.entries(COUNTRY_MAP)) {
  NAME_TO_CODE[country.toLowerCase()] = code;
}

// ─── ccTLD Map ─────────────────────────────────────────────

/** Map of ccTLD to country code. */
const CCTLD_MAP: Record<string, string> = {
  af: "AF", al: "AL", dz: "DZ", ar: "AR", am: "AM",
  au: "AU", at: "AT", az: "AZ", bd: "BD", by: "BY",
  be: "BE", br: "BR", bg: "BG", kh: "KH", ca: "CA",
  cl: "CL", cn: "CN", co: "CO", hr: "HR", cy: "CY",
  cz: "CZ", dk: "DK", ee: "EE", fi: "FI", fr: "FR",
  ge: "GE", de: "DE", gr: "GR", hk: "HK", hu: "HU",
  in: "IN", id: "ID", ir: "IR", iq: "IQ", ie: "IE",
  il: "IL", it: "IT", jp: "JP", jo: "JO", kz: "KZ",
  ke: "KE", kr: "KR", kw: "KW", kg: "KG", lv: "LV",
  lt: "LT", lu: "LU", mo: "MO", my: "MY", mx: "MX",
  md: "MD", mn: "MN", nl: "NL", nz: "NZ", ng: "NG",
  mk: "MK", no: "NO", pk: "PK", pa: "PA", ph: "PH",
  pl: "PL", pt: "PT", qa: "QA", ro: "RO", ru: "RU",
  sa: "SA", rs: "RS", sg: "SG", sk: "SK", si: "SI",
  za: "ZA", es: "ES", se: "SE", ch: "CH", tw: "TW",
  th: "TH", tr: "TR", ua: "UA", ae: "AE", gb: "GB",
  us: "US", uz: "UZ", vn: "VN",
};
// ─── Extra country names for source name matching ──────────

const EXTRA_NAMES: Record<string, string> = {
  "germany": "DE", "france": "FR", "usa": "US",
  "united states": "US", "united kingdom": "GB", "uk": "GB",
  "netherlands": "NL", "holland": "NL", "japan": "JP",
  "korea": "KR", "south korea": "KR", "singapore": "SG",
  "hong kong": "HK", "turkey": "TR", "turkiye": "TR",
  "russia": "RU", "iran": "IR", "india": "IN", "brazil": "BR",
  "canada": "CA", "australia": "AU", "spain": "ES", "italy": "IT",
  "sweden": "SE", "norway": "NO", "denmark": "DK", "finland": "FI",
  "switzerland": "CH", "austria": "AT", "poland": "PL",
  "ukraine": "UA", "romania": "RO", "bulgaria": "BG", "czech": "CZ",
  "czechia": "CZ", "hungary": "HU", "greece": "GR", "portugal": "PT",
  "ireland": "IE", "belgium": "BE", "malaysia": "MY",
  "thailand": "TH", "vietnam": "VN", "indonesia": "ID",
  "philippines": "PH", "taiwan": "TW", "mexico": "MX",
  "argentina": "AR", "colombia": "CO", "chile": "CL",
  "israel": "IL", "uae": "AE", "dubai": "AE", "saudi": "SA",
  "pakistan": "PK", "bangladesh": "BD", "nigeria": "NG",
  "kenya": "KE", "south africa": "ZA", "new zealand": "NZ",
  "estonia": "EE", "latvia": "LV", "lithuania": "LT",
  "serbia": "RS", "croatia": "HR", "slovenia": "SI",
  "slovakia": "SK", "georgia": "GE", "armenia": "AM",
  "azerbaijan": "AZ", "kazakhstan": "KZ", "uzbekistan": "UZ",
  "mongolia": "MN", "cambodia": "KH", "jordan": "JO",
  "kuwait": "KW", "qatar": "QA", "iraq": "IQ", "cyprus": "CY",
  "luxembourg": "LU", "iceland": "IS", "panama": "PA",
  "moldova": "MD", "belarus": "BY", "kyrgyzstan": "KG",
  "macau": "MO",
};

// ─── Helper: make result from code ─────────────────────────

function makeResult(countryCode: string): LocationResult {
  const entry = COUNTRY_MAP[countryCode];
  if (!entry) {
    return { country: "Unknown", countryCode: "XX", flag: "\u{1F30D}", display: "\u{1F30D} Unknown", confidence: "none" };
  }
  return {
    country: entry.country,
    countryCode,
    flag: entry.flag,
    display: entry.flag + " " + entry.country,
    confidence: "high",
  };
}

// ─── Detection from fragment ───────────────────────────────

export function detectFromFragment(fragment: string): LocationResult | null {
  if (!fragment) return null;
  let text = fragment;
  try { text = decodeURIComponent(text); } catch { /* not encoded */ }
  text = text.trim();
  if (!text) return null;

  // 1. Flag emoji
  const flagMatch = text.match(/[\u{1F1E0}-\u{1F1FF}]{2}/u);
  if (flagMatch) {
    const code = extractCodeFromFlag(flagMatch[0]);
    if (code && COUNTRY_MAP[code]) return { ...makeResult(code), confidence: "high" };
  }

  // 2. CC-prefix: "DE-Frankfurt", "US-1"
  const ccPrefix = text.match(/^([A-Z]{2})\b/i);
  if (ccPrefix) {
    const code = ccPrefix[1].toUpperCase();
    if (COUNTRY_MAP[code]) return { ...makeResult(code), confidence: "high" };
  }

  // 3. CC anywhere: "Server DE"
  const ccWord = text.match(/\b([A-Z]{2})\b/);
  if (ccWord) {
    const code = ccWord[1].toUpperCase();
    if (COUNTRY_MAP[code]) return { ...makeResult(code), confidence: "medium" };
  }

  // 4. Country name
  const lower = text.toLowerCase();
  for (const [name, code] of Object.entries(EXTRA_NAMES)) {
    if (lower.includes(name)) return { ...makeResult(code), confidence: "high" };
  }
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (lower.includes(name)) return { ...makeResult(code), confidence: "high" };
  }

  return null;
}

// ─── Detection from hostname ───────────────────────────────

export function detectFromHostname(hostname: string): LocationResult | null {
  if (!hostname) return null;
  const lower = hostname.toLowerCase().trim();

  // Skip IPs
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) return null;
  if (lower.includes(":")) return null;

  // 1. ccTLD
  const dotParts = lower.split(".");
  if (dotParts.length >= 2) {
    const tld = dotParts[dotParts.length - 1];
    const code = CCTLD_MAP[tld];
    if (code) return { ...makeResult(code), confidence: "medium" };
  }

  // 2. Prefix pattern: "de-de1.xxx"
  const prefixMatch = lower.match(/^([a-z]{2})[-_]/);
  if (prefixMatch) {
    const code = CCTLD_MAP[prefixMatch[1]];
    if (code) return { ...makeResult(code), confidence: "low" };
  }

  return null;
}

// ─── Detection from source name ────────────────────────────

export function detectFromSourceName(name: string): LocationResult | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();

  for (const [pattern, code] of Object.entries(EXTRA_NAMES)) {
    if (lower.includes(pattern)) return { ...makeResult(code), confidence: "low" };
  }
  for (const [countryName, code] of Object.entries(NAME_TO_CODE)) {
    if (lower.includes(countryName)) return { ...makeResult(code), confidence: "low" };
  }

  return null;
}

// ─── Flag emoji to country code ────────────────────────────

function extractCodeFromFlag(flag: string): string | null {
  const chars = [...flag];
  if (chars.length !== 2) return null;
  const cp = chars.map((c) => c.codePointAt(0)!);
  if (cp[0] < 0x1f1e6 || cp[0] > 0x1f1ff || cp[1] < 0x1f1e6 || cp[1] > 0x1f1ff) return null;
  const a = String.fromCodePoint(cp[0] - 0x1f1e6 + 0x41);
  const b = String.fromCodePoint(cp[1] - 0x1f1e6 + 0x41);
  return a + b;
}

// ─── Main Orchestrator ─────────────────────────────────────

export function detectLocation(
  fragment?: string,
  hostname?: string,
  sourceName?: string
): LocationResult {
  if (fragment) {
    const r = detectFromFragment(fragment);
    if (r) return r;
  }
  if (hostname) {
    const r = detectFromHostname(hostname);
    if (r) return r;
  }
  if (sourceName) {
    const r = detectFromSourceName(sourceName);
    if (r) return r;
  }
  return { country: "Unknown", countryCode: "XX", flag: "\u{1F30D}", display: "\u{1F30D} Unknown", confidence: "none" };
}

// ─── Exports for testing ───────────────────────────────────

export function getCountryCount(): number {
  return Object.keys(COUNTRY_MAP).length;
}

export function isValidCountryCode(code: string): boolean {
  return code in COUNTRY_MAP;
}
