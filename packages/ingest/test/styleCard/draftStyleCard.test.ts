import { readFileSync } from 'node:fs';
import { LIMITS } from '@edmate/contracts';
import { manualClock, ScriptedGateway, type GatewayScript } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { IngestError } from '../../src/errors.js';
import { draftStyleCard, type DraftStyleCardInput } from '../../src/styleCard/draftStyleCard.js';

const scripted = (script: GatewayScript): ScriptedGateway =>
  new ScriptedGateway(script, manualClock());

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/styleCard/${name}`, import.meta.url), 'utf8')) as T;

const BASE_INPUT: DraftStyleCardInput = {
  answers: fixture('answers.json'),
  sampleExplanations: fixture('sampleExplanations.json'),
  mistakeCandidates: fixture('mistakeCandidates.json'),
};

describe('draftStyleCard', () => {
  it('acceptance: the style card is <=300 words and includes the mistakes list', async () => {
    const draftedCard = fixture('draftedCard.json');
    const gateway = scripted({ generateObject: [{ value: draftedCard }] });

    const result = await draftStyleCard(gateway, BASE_INPUT);

    const words = result.text.split(/\s+/).filter((w) => w !== '').length;
    expect(words).toBeLessThanOrEqual(LIMITS.styleCardMaxWords);
    expect(result.mistakeTags.length).toBeGreaterThan(0);
    for (const tag of result.mistakeTags) {
      expect(BASE_INPUT.mistakeCandidates).toContain(tag);
    }
  });

  it('rejects a scripted answer with a mistake tag outside the candidate list', async () => {
    const gateway = scripted({
      generateObject: [
        {
          value: { text: 'Short card.', mistakeTags: ['not-a-real-tag'] },
        },
      ],
    });

    await expect(draftStyleCard(gateway, BASE_INPUT)).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
    });
  });

  it('rejects a scripted answer longer than the word limit', async () => {
    const longText = Array.from({ length: LIMITS.styleCardMaxWords + 10 }, () => 'word').join(' ');
    const gateway = scripted({
      generateObject: [{ value: { text: longText, mistakeTags: [] } }],
    });

    await expect(draftStyleCard(gateway, BASE_INPUT)).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
      retryable: false,
    });
  });

  it('wraps a gateway failure in a fixed IngestError', async () => {
    const gateway = scripted({ generateObject: [] });

    await expect(draftStyleCard(gateway, BASE_INPUT)).rejects.toBeInstanceOf(IngestError);
  });
});
