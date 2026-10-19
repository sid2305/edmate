// The sentence-gate seam (task 3.7, plan Q7). Every streamed text piece passes through a gate
// before the student sees it. 3.7 ships a pass-through, so first-token latency is unchanged; 4.5
// swaps in sentence buffering plus the incremental answer-key and locked n-gram checks.
import type { PedagogyDecision, TurnContext } from '@edmate/contracts';

export interface StreamGate {
  /** Text the model streamed; returns the pieces to show now, in order (maybe none). */
  push(text: string): readonly string[];
  /** A model call ended: returns any held text to show now. */
  flush(): readonly string[];
}

/** One gate per generate attempt, built with what it needs to judge the text. */
export type StreamGateFactory = (x: { ctx: TurnContext; decision: PedagogyDecision }) => StreamGate;

export const passThroughGate: StreamGateFactory = () => ({
  push: (text) => (text === '' ? [] : [text]),
  flush: () => [],
});
