// Shared "pending" sign-off check (task 5.8e; 5.8a review follow-up #4): `promptPacks.ts`,
// `personaTemplates.ts` and `agePolicy.ts` each repeat the same rule — a reviewer is signed off
// once `reviewedBy` is set and is not (trimmed, case-insensitive) "pending". One helper covers all
// three call sites: the two that only ever see a required `string`, and `agePolicy.ts`'s
// `complianceSigned`, whose `LocalePack['reviewedBy']` is optional.

/** True once `value` is set and is not (trimmed, case-insensitive) "pending". */
export function isSignedOff(value: string | undefined): boolean {
  return value !== undefined && value.trim().toLowerCase() !== 'pending';
}
