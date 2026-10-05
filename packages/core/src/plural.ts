/**
 * The English plural for a count.
 * The default is +s. State an irregular form in the third argument (the current vocabulary — change / file / problem / error / warning — is covered by the default).
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}
