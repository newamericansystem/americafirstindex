export interface District {
  state: string;
  district: number;
}

export declare const STATE_NAMES: Readonly<Record<string, string>>;
export declare const STATE_FIPS_TO_USPS: Readonly<Record<string, string>>;
export declare const USPS_TO_STATE_FIPS: Readonly<Record<string, string>>;
export declare const AT_LARGE_STATES: readonly string[];

export declare function toMapDistKey(csvDistrict: string | null | undefined): string | null;
export declare function parseDistKey(distKey: string | null | undefined): District | null;
export declare function formatCsvDistrict(
  dist: District,
  atLargeStates?: readonly string[]
): string | null;
