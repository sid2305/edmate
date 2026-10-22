// Each exported type must be exactly the Core contracts type (spec-types.ts is the verbatim copy).
// `toEqualTypeOf` is checked by tsc (the typecheck script includes test/), in both directions.
import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type * as C from '../src/index.js';
import type * as Spec from './spec-types.js';

describe('z.infer types equal the Core contracts', () => {
  it('data types', () => {
    expectTypeOf<C.Lang>().toEqualTypeOf<Spec.Lang>();
    expectTypeOf<C.Skill>().toEqualTypeOf<Spec.Skill>();
    expectTypeOf<C.Money>().toEqualTypeOf<Spec.Money>();
    expectTypeOf<C.ErrorCode>().toEqualTypeOf<Spec.ErrorCode>();
    expectTypeOf<C.Usage>().toEqualTypeOf<Spec.Usage>();
    expectTypeOf<C.ToolName>().toEqualTypeOf<Spec.ToolName>();
    expectTypeOf<C.AgentConfig>().toEqualTypeOf<Spec.AgentConfig>();
    expectTypeOf<C.StyleCard>().toEqualTypeOf<Spec.StyleCard>();
    expectTypeOf<C.PackageConfig>().toEqualTypeOf<Spec.PackageConfig>();
    expectTypeOf<C.Entitlement>().toEqualTypeOf<Spec.Entitlement>();
    expectTypeOf<C.ChunkKind>().toEqualTypeOf<Spec.ChunkKind>();
    expectTypeOf<C.SourceRef>().toEqualTypeOf<Spec.SourceRef>();
    expectTypeOf<C.Chunk>().toEqualTypeOf<Spec.Chunk>();
    expectTypeOf<C.Attachment>().toEqualTypeOf<Spec.Attachment>();
    expectTypeOf<C.Message>().toEqualTypeOf<Spec.Message>();
    expectTypeOf<C.TurnInput>().toEqualTypeOf<Spec.TurnInput>();
    expectTypeOf<C.Intent>().toEqualTypeOf<Spec.Intent>();
    expectTypeOf<C.Attempt>().toEqualTypeOf<Spec.Attempt>();
    expectTypeOf<C.Persona>().toEqualTypeOf<Spec.Persona>();
    expectTypeOf<C.TurnContext>().toEqualTypeOf<Spec.TurnContext>();
    expectTypeOf<C.PedagogyDecision>().toEqualTypeOf<Spec.PedagogyDecision>();
    expectTypeOf<C.TeacherQuestion>().toEqualTypeOf<Spec.TeacherQuestion>();
    expectTypeOf<C.TurnEvent>().toEqualTypeOf<Spec.TurnEvent>();
    expectTypeOf<C.ModelPolicy>().toEqualTypeOf<Spec.ModelPolicy>();
    expectTypeOf<C.ModelRequest>().toEqualTypeOf<Spec.ModelRequest>();
    expectTypeOf<C.ModelChunk>().toEqualTypeOf<Spec.ModelChunk>();
    expectTypeOf<C.SafetyAlert>().toEqualTypeOf<Spec.SafetyAlert>();
    expectTypeOf<C.GuardResult>().toEqualTypeOf<Spec.GuardResult>();
    expectTypeOf<C.LearnerProfile>().toEqualTypeOf<Spec.LearnerProfile>();
    expectTypeOf<C.TurnTrace>().toEqualTypeOf<Spec.TurnTrace>();
    expectTypeOf<C.LocalePack>().toEqualTypeOf<Spec.LocalePack>();
    expectTypeOf<C.EvidenceEvent>().toEqualTypeOf<Spec.EvidenceEvent>();
    expectTypeOf<C.TranscribeInput>().toEqualTypeOf<Spec.TranscribeInput>();
    expectTypeOf<C.TranscriptSegment>().toEqualTypeOf<Spec.TranscriptSegment>();
    expectTypeOf<C.Transcript>().toEqualTypeOf<Spec.Transcript>();
    expectTypeOf<C.SafetyEventCode>().toEqualTypeOf<Spec.SafetyEventCode>();
    expectTypeOf<C.ProviderId>().toEqualTypeOf<Spec.ProviderId>();
    expectTypeOf<C.ProviderRef>().toEqualTypeOf<Spec.ProviderRef>();
    expectTypeOf<C.PaymentOffer>().toEqualTypeOf<Spec.PaymentOffer>();
    expectTypeOf<C.ProviderSubscription>().toEqualTypeOf<Spec.ProviderSubscription>();
    expectTypeOf<C.PaymentFact>().toEqualTypeOf<Spec.PaymentFact>();
    expectTypeOf<C.PaymentEvent>().toEqualTypeOf<Spec.PaymentEvent>();
  });

  it('ports (type-only)', () => {
    expectTypeOf<C.Guard>().toEqualTypeOf<Spec.Guard>();
    expectTypeOf<C.RetrievalIndex>().toEqualTypeOf<Spec.RetrievalIndex>();
    expectTypeOf<C.EntitlementStore>().toEqualTypeOf<Spec.EntitlementStore>();
    expectTypeOf<C.TurnConfigStore>().toEqualTypeOf<Spec.TurnConfigStore>();
    expectTypeOf<C.ProfileStore>().toEqualTypeOf<Spec.ProfileStore>();
    expectTypeOf<C.TranscriptStore>().toEqualTypeOf<Spec.TranscriptStore>();
    expectTypeOf<C.SessionStateStore>().toEqualTypeOf<Spec.SessionStateStore>();
    expectTypeOf<C.Transcriber>().toEqualTypeOf<Spec.Transcriber>();
    expectTypeOf<C.CorrectionStore>().toEqualTypeOf<Spec.CorrectionStore>();
    expectTypeOf<C.TeacherQuestionStore>().toEqualTypeOf<Spec.TeacherQuestionStore>();
    expectTypeOf<C.UsageMeter>().toEqualTypeOf<Spec.UsageMeter>();
    expectTypeOf<C.ModelGateway>().toEqualTypeOf<Spec.ModelGateway>();
    expectTypeOf<C.TraceSink>().toEqualTypeOf<Spec.TraceSink>();
    expectTypeOf<C.AlertSink>().toEqualTypeOf<Spec.AlertSink>();
    expectTypeOf<C.SafetyEventSink>().toEqualTypeOf<Spec.SafetyEventSink>();
    expectTypeOf<C.Payments>().toEqualTypeOf<Spec.Payments>();
    expectTypeOf<C.Tool<{ a: number }, string>>().toEqualTypeOf<Spec.Tool<{ a: number }, string>>();
  });
});

describe('SafetyEventSink (ADR-0006)', () => {
  type Event = Parameters<C.SafetyEventSink['record']>[0];

  it('records ids, the guard, a fixed code and the source; no free text field', () => {
    expectTypeOf<keyof Event>().toEqualTypeOf<
      'studentId' | 'teacherId' | 'sessionId' | 'turnId' | 'guard' | 'code' | 'source'
    >();
    expectTypeOf<Event['guard']>().toEqualTypeOf<'moderationIn' | 'jailbreak'>();
    expectTypeOf<Event['source']>().toEqualTypeOf<'rule' | 'classifier'>();
    expectTypeOf<Event['code']>().toEqualTypeOf<C.SafetyEventCode>();
    expectTypeOf<ReturnType<C.SafetyEventSink['record']>>().toEqualTypeOf<Promise<void>>();
  });

  it('a code is one of the fixed set, never an arbitrary string', () => {
    expectTypeOf<string>().not.toExtend<C.SafetyEventCode>();
    expectTypeOf<'jailbreak_override'>().toExtend<C.SafetyEventCode>();
    expectTypeOf<'self_harm'>().toExtend<C.SafetyEventCode>();
  });
});

describe('RetrievalIndex.leakCheck (ADR-0007)', () => {
  type LeakCheck = C.RetrievalIndex['leakCheck'];

  it('takes a batch of candidate texts and the allowed-module scope (the complement is checked)', () => {
    expectTypeOf<Parameters<LeakCheck>>().toEqualTypeOf<
      [candidates: readonly string[], scope: { teacherId: string; allowedModuleIds: string[] }]
    >();
  });

  it('returns one boolean for the whole batch: no text, span, score or count', () => {
    expectTypeOf<Awaited<ReturnType<LeakCheck>>>().toEqualTypeOf<{ hit: boolean }>();
    expectTypeOf<Awaited<ReturnType<LeakCheck>>>().not.toHaveProperty('score');
    expectTypeOf<Awaited<ReturnType<LeakCheck>>>().not.toHaveProperty('spans');
  });

  it('is a required member, so every adapter must implement it', () => {
    expectTypeOf<{
      search: C.RetrievalIndex['search'];
      probe: C.RetrievalIndex['probe'];
    }>().not.toExtend<C.RetrievalIndex>();
  });
});

describe('Payments (ADR-0015)', () => {
  type P = C.Payments;
  type Sub = z.infer<typeof C.ProviderSubscriptionSchema>;

  it('every write returns a Promise of the schema types', () => {
    expectTypeOf<ReturnType<P['changePlan']>>().toEqualTypeOf<Promise<Sub>>();
    expectTypeOf<ReturnType<P['pause']>>().toEqualTypeOf<Promise<Sub>>();
    expectTypeOf<ReturnType<P['resume']>>().toEqualTypeOf<Promise<Sub>>();
    expectTypeOf<ReturnType<P['cancel']>>().toEqualTypeOf<Promise<Sub>>();
    expectTypeOf<ReturnType<P['clearScheduled']>>().toEqualTypeOf<Promise<Sub>>();
    expectTypeOf<ReturnType<P['getSubscription']>>().toEqualTypeOf<Promise<Sub>>();
    expectTypeOf<ReturnType<P['parseWebhook']>>().toEqualTypeOf<
      Promise<z.infer<typeof C.PaymentEventSchema>>
    >();
    expectTypeOf<Parameters<P['startCheckout']>[0]['offer']>().toEqualTypeOf<
      z.infer<typeof C.PaymentOfferSchema>
    >();
  });

  it('parseWebhook takes the raw bytes, never a re-serialised string', () => {
    type In = Parameters<P['parseWebhook']>[0];
    expectTypeOf<In['rawBody']>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<string>().not.toExtend<In['rawBody']>();
  });

  it("changePlan 'now' must say how to prorate; 'period_end' takes no proration", () => {
    type In = Parameters<P['changePlan']>[0];
    const base = { providerRef: 'sub_fake_0001', offer: {} as C.PaymentOffer, idempotencyKey: 'k' };
    expectTypeOf({ ...base, when: 'now' as const, proration: 'prorate' as const }).toExtend<In>();
    expectTypeOf({ ...base, when: 'period_end' as const }).toExtend<In>();
    expectTypeOf({ ...base, when: 'now' as const }).not.toExtend<In>();
  });

  it('refund returns only a ref and a pending or succeeded status', () => {
    expectTypeOf<Awaited<ReturnType<P['refund']>>>().toEqualTypeOf<{
      refundRef: string;
      status: 'pending' | 'succeeded';
    }>();
  });

  it('a provider status is exactly the Entitlement status enum', () => {
    expectTypeOf<C.ProviderSubscription['status']>().toEqualTypeOf<C.Entitlement['status']>();
  });
});
