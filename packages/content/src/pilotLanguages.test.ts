import { describe, expect, it } from 'vitest';
import { checkPilotLanguages, PILOT_LANGUAGES } from './pilotLanguages.js';

describe('checkPilotLanguages', () => {
  it('passes exactly ["en"]', () => {
    expect(checkPilotLanguages(['en'])).toEqual([]);
  });

  it('rejects a config with an extra language', () => {
    const issues = checkPilotLanguages(['en', 'hi']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/agent languages must be exactly \[en\] during the pilot/);
    expect(issues[0]).toContain('[en, hi]');
  });

  it('rejects a language other than English', () => {
    expect(checkPilotLanguages(['hi'])).not.toEqual([]);
  });

  it('rejects an empty list', () => {
    expect(checkPilotLanguages([])).not.toEqual([]);
  });

  it('rejects the right language out of order', () => {
    expect(checkPilotLanguages(['hi', 'en'])).not.toEqual([]);
  });

  it('PILOT_LANGUAGES is exactly ["en"]', () => {
    expect(PILOT_LANGUAGES).toEqual(['en']);
  });
});
