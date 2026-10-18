import { describe, expect, it } from 'vitest';
import * as gateway from '../../src/index.js';

describe('package exports', () => {
  it('exports the key module, the adapters, the router, pricing and metering, and keeps internals internal', () => {
    expect(Object.keys(gateway).sort()).toEqual(
      [
        'ANTHROPIC_CAPABILITIES',
        'DEFAULT_MODEL_POLICY',
        'GatewayError',
        'Router',
        'createRouter',
        'KeyConfigError',
        'OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES',
        'PROVIDER_KEYS',
        'Secret',
        'createAnthropicAdapter',
        'createOpenAICompatibleAdapter',
        'envKeySource',
        'loadProviderKeys',
        'mapProviderError',
        'computeCostMicroUsd',
        'createMeter',
        'meterAdapter',
        'meterRouter',
        'loadBundledPrices',
        'parsePriceTable',
        'PriceTableError',
        // Task 2.7: transcription and the platform embedding model.
        'createWhisperTranscriber',
        'DEFAULT_MAX_DOWNLOAD_BYTES',
        'WHISPER_MAX_UPLOAD_BYTES',
        'WHISPER_MODEL',
        'defaultChunker',
        'TranscriberError',
        'redactUrl',
        'meterTranscriber',
        'createEmbeddingAdapter',
        'EMBEDDING_CONFIG',
      ].sort(),
    );
    expect('keyValueSchema' in gateway).toBe(false);
    expect('createSdkAdapter' in gateway).toBe(false);
    expect('missingCapability' in gateway).toBe(false);
    expect('ModelPriceSchema' in gateway).toBe(false);
    expect('createOpenAITranscriptionModel' in gateway).toBe(false);
    expect('createScriptedTranscriber' in gateway).toBe(false);
  });
});
