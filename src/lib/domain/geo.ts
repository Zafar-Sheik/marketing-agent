/**
 * ISO 3166 country code -> TikTok location id (TikTok uses GeoNames ids for countries).
 * Extend as you onboard clients in new markets; /tool/region/ on the Marketing API lists all ids.
 */
export const COUNTRY_LOCATION_IDS: Record<string, string> = {
  AE: '290557', AR: '3865483', AU: '2077456', BE: '2802361', BR: '3469034', CA: '6251999', CH: '2658434',
  CL: '3895114', CO: '3686110', CZ: '3077311', DE: '2921044', DK: '2623032', EG: '357994', ES: '2510769',
  FI: '660013', FR: '3017382', GB: '2635167', GH: '2300660', GR: '390903', ID: '1643084', IE: '2963597',
  IL: '294640', IT: '3175395', JP: '1861060', KE: '192950', KR: '1835841', MA: '2542007', MX: '3996063',
  MY: '1733045', NG: '2328926', NL: '2750405', NO: '3144096', NZ: '2186224', PE: '3932488', PH: '1694008',
  PK: '1168579', PL: '798544', PT: '2264397', QA: '289688', RO: '798549', SA: '102358', SE: '2661886',
  SG: '1880251', TH: '1605651', TR: '298795', TW: '1668284', UA: '690791', US: '6252001', VN: '1562822',
  ZA: '953987',
};

export function locationIdsFor(countries: string[]): string[] {
  return [...new Set(countries.map((c) => COUNTRY_LOCATION_IDS[c.toUpperCase()]).filter(Boolean))];
}
