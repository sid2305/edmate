import { describe, expect, it } from 'vitest';
import {
  demoAgentConfig,
  demoPackageFree,
  demoTurnInput,
  manualClock,
  ScriptedGateway,
  ScriptedGatewayError,
  ScriptedProviderError,
  schemas,
  scriptedEmbedPair,
  scriptedObjectIntent,
  scriptedStreamProviderError,
  scriptedStreamText,
  scriptedStreamToolCall,
  scriptedStreamWithDelay,
  validFixtures,
} from './index.js';

// The harness has no zod dependency yet, so the schemas are used through this minimal shape.
type Parser = { safeParse(value: unknown): { success: boolean } };

describe('harness/testing re-exports the contracts fixtures', () => {
  const names = Object.keys(schemas) as (keyof typeof schemas)[];

  it('covers every schema', () => {
    expect(names).toHaveLength(32);
  });

  it.each(names)('%s: the first fixture parses', (name) => {
    const [first] = validFixtures[name];
    expect(first).toBeDefined();
    expect((schemas[name] as Parser).safeParse(first).success).toBe(true);
  });

  it('exposes the named demo fixtures', () => {
    expect(schemas.AgentConfig.parse(demoAgentConfig).id).toBe('agt_test_01');
    expect(schemas.PackageConfig.parse(demoPackageFree).pricePerMonth.amountMinor).toBe(0);
    expect(schemas.TurnInput.parse(demoTurnInput).kind).toBe('message');
  });
});

describe('harness/testing exports the scripted gateway and its demo scripts', () => {
  const streams = {
    scriptedStreamText,
    scriptedStreamToolCall,
    scriptedStreamWithDelay,
    scriptedStreamProviderError,
  };

  it('exports the gateway, its errors and the manual clock', () => {
    expect(typeof ScriptedGateway).toBe('function');
    expect(typeof ScriptedGatewayError).toBe('function');
    expect(typeof ScriptedProviderError).toBe('function');
    expect(typeof manualClock).toBe('function');
  });

  it.each(Object.entries(streams))('%s: every chunk step parses as a ModelChunk', (_, call) => {
    const chunks = call.steps.filter((s) => s.type !== 'delay' && s.type !== 'error');
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect((schemas.ModelChunk as Parser).safeParse(chunk).success).toBe(true);
    }
  });

  it('attaches valid usage to the object and embed scripts', () => {
    expect((schemas.Usage as Parser).safeParse(scriptedObjectIntent.usage).success).toBe(true);
    expect((schemas.Usage as Parser).safeParse(scriptedEmbedPair.usage).success).toBe(true);
    expect(scriptedEmbedPair.vectors).toHaveLength(2);
  });
});
