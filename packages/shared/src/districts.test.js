import { describe, expect, it } from 'vitest';
import {
  AT_LARGE_STATES,
  STATE_FIPS_TO_USPS,
  STATE_NAMES,
  USPS_TO_STATE_FIPS,
  formatCsvDistrict,
  parseDistKey,
  toMapDistKey,
} from './index.js';

describe('toMapDistKey', () => {
  it('converts CSV districts to map keys', () => {
    expect(toMapDistKey('AZ-05')).toBe('AZ-5');
    expect(toMapDistKey('WY-AL')).toBe('WY-1');
    expect(toMapDistKey('TX-23')).toBe('TX-23');
  });

  it('treats district 0 as at-large', () => {
    expect(toMapDistKey('WY-0')).toBe('WY-1');
    expect(toMapDistKey('AK-00')).toBe('AK-1');
  });

  it('normalizes case and whitespace', () => {
    expect(toMapDistKey(' tx-23 ')).toBe('TX-23');
    expect(toMapDistKey('wy-al')).toBe('WY-1');
  });

  it('returns null for invalid input', () => {
    for (const bad of [null, undefined, '', 'TX', 'TX-', '-5', 'TX-XX', 'XX-5', 'TX-123', 'TX-5-1', 23]) {
      expect(toMapDistKey(bad)).toBeNull();
    }
  });

  it('round-trips every district in the ratings CSV format', () => {
    for (const state of Object.keys(USPS_TO_STATE_FIPS)) {
      const csv = formatCsvDistrict({ state, district: 3 });
      expect(parseDistKey(csv)).toEqual({
        state,
        district: AT_LARGE_STATES.includes(state) ? 1 : 3,
      });
    }
  });
});

describe('parseDistKey', () => {
  it('splits a map key', () => {
    expect(parseDistKey('TX-23')).toEqual({ state: 'TX', district: 23 });
    expect(parseDistKey('WY-1')).toEqual({ state: 'WY', district: 1 });
  });

  it('accepts CSV forms', () => {
    expect(parseDistKey('AZ-05')).toEqual({ state: 'AZ', district: 5 });
    expect(parseDistKey('WY-AL')).toEqual({ state: 'WY', district: 1 });
  });

  it('returns null for invalid input', () => {
    expect(parseDistKey('nope')).toBeNull();
    expect(parseDistKey(null)).toBeNull();
  });
});

describe('formatCsvDistrict', () => {
  it('zero-pads district numbers', () => {
    expect(formatCsvDistrict({ state: 'AZ', district: 5 })).toBe('AZ-05');
    expect(formatCsvDistrict({ state: 'TX', district: 23 })).toBe('TX-23');
  });

  it('uses AL for at-large states', () => {
    expect(formatCsvDistrict({ state: 'WY', district: 1 })).toBe('WY-AL');
    expect(formatCsvDistrict({ state: 'MT', district: 1 }, ['MT'])).toBe('MT-AL');
    expect(formatCsvDistrict({ state: 'WY', district: 1 }, [])).toBe('WY-01');
  });

  it('returns null for invalid input', () => {
    expect(formatCsvDistrict({ state: 'XX', district: 1 })).toBeNull();
    expect(formatCsvDistrict({ state: 'TX', district: 0 })).toBeNull();
    expect(formatCsvDistrict({ state: 'TX', district: 1.5 })).toBeNull();
  });
});

describe('state maps', () => {
  it('cover the 50 states and DC', () => {
    expect(Object.keys(STATE_FIPS_TO_USPS)).toHaveLength(51);
    expect(Object.keys(USPS_TO_STATE_FIPS)).toHaveLength(51);
    expect(Object.keys(STATE_NAMES).sort()).toEqual(Object.keys(USPS_TO_STATE_FIPS).sort());
    expect(STATE_FIPS_TO_USPS['01']).toBe('AL');
    expect(STATE_FIPS_TO_USPS['11']).toBe('DC');
    expect(STATE_FIPS_TO_USPS['56']).toBe('WY');
  });

  it('round-trips FIPS ↔ USPS for every state', () => {
    for (const [fips, usps] of Object.entries(STATE_FIPS_TO_USPS)) {
      expect(fips).toMatch(/^\d{2}$/);
      expect(USPS_TO_STATE_FIPS[usps]).toBe(fips);
      expect(STATE_FIPS_TO_USPS[USPS_TO_STATE_FIPS[usps]]).toBe(usps);
    }
  });
});
