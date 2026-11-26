/** USPS abbreviation → full name, for the 50 states + DC. */
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** Two-digit state FIPS code → USPS abbreviation, for the 50 states + DC. */
export const STATE_FIPS_TO_USPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

/** USPS abbreviation → two-digit state FIPS code. */
export const USPS_TO_STATE_FIPS = Object.fromEntries(
  Object.entries(STATE_FIPS_TO_USPS).map(([fips, usps]) => [usps, fips])
);

/** States with a single at-large House seat (119th Congress). */
export const AT_LARGE_STATES = ['AK', 'DE', 'ND', 'SD', 'VT', 'WY'];

/**
 * Normalize a district string to the map key format.
 * Accepts CSV ("AZ-05", "WY-AL") and map ("TX-23") forms; at-large ("AL" or 0) becomes 1.
 * Returns null for anything that is not a known state plus a district number.
 * @param {string | null | undefined} csvDistrict
 * @returns {string | null}
 */
export function toMapDistKey(csvDistrict) {
  if (typeof csvDistrict !== 'string') return null;
  const m = /^\s*([A-Za-z]{2})-(AL|\d{1,2})\s*$/i.exec(csvDistrict);
  if (!m) return null;
  const state = m[1].toUpperCase();
  if (!(state in USPS_TO_STATE_FIPS)) return null;
  const n = m[2].toUpperCase() === 'AL' ? 1 : Number(m[2]);
  return `${state}-${n === 0 ? 1 : n}`;
}

/**
 * "TX-23" → { state: "TX", district: 23 }. Also accepts CSV forms ("WY-AL").
 * @param {string | null | undefined} distKey
 * @returns {{ state: string, district: number } | null}
 */
export function parseDistKey(distKey) {
  const key = toMapDistKey(distKey);
  if (!key) return null;
  const [state, district] = key.split('-');
  return { state, district: Number(district) };
}

/**
 * Inverse of toMapDistKey: { state: "AZ", district: 5 } → "AZ-05", at-large states → "WY-AL".
 * @param {{ state: string, district: number }} dist
 * @param {readonly string[]} [atLargeStates]
 * @returns {string | null}
 */
export function formatCsvDistrict({ state, district } = {}, atLargeStates = AT_LARGE_STATES) {
  const usps = typeof state === 'string' ? state.toUpperCase() : '';
  if (!(usps in USPS_TO_STATE_FIPS)) return null;
  if (atLargeStates.includes(usps)) return `${usps}-AL`;
  if (!Number.isInteger(district) || district < 1 || district > 99) return null;
  return `${usps}-${String(district).padStart(2, '0')}`;
}
