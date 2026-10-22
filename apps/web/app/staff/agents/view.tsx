'use client';
// Task 12.4d: the staff regulated-subject console. The initial list comes from the server page and
// is still checked with zod (a wrong shape or a failed server read is the fallback view, with a
// reload). One action at a time: every action clears the old message, sets one busy flag and
// resets it in `finally` -- an error reply or a thrown call never leaves the buttons disabled
// (lessons: "UI state and server replies: trust neither, reset everything").
import type { ErrorCode } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AgentRow } from './agent-row';
import {
  loadAgents as defaultLoadAgents,
  setApproval as defaultSetApproval,
  setSubject as defaultSetSubject,
  AgentListSchema,
  type AgentView,
} from './client';

export interface StaffAgentsViewProps {
  /** The server's read of the agent list; `null` when that read failed. Checked here, not trusted. */
  initial: unknown;
  /** Tests inject fakes; defaults call `/api/staff/agents`. */
  setSubject?: typeof defaultSetSubject;
  setApproval?: typeof defaultSetApproval;
  loadAgents?: typeof defaultLoadAgents;
}

type Busy = { kind: 'subject' | 'approval'; agentId: string } | { kind: 'reload' } | null;
type ErrorKey = 'forbidden' | 'not_found' | 'validation' | 'generic' | 'loadFailed';

function errorKey(code: ErrorCode): ErrorKey {
  return code === 'forbidden' || code === 'not_found' || code === 'validation' ? code : 'generic';
}

function parseInitial(initial: unknown): AgentView[] | null {
  const parsed = AgentListSchema.safeParse(initial);
  return parsed.success ? parsed.data : null;
}

export function StaffAgentsView({
  initial,
  setSubject = defaultSetSubject,
  setApproval = defaultSetApproval,
  loadAgents = defaultLoadAgents,
}: StaffAgentsViewProps) {
  const t = useTranslations('staffAgents');
  const [agents, setAgents] = useState<AgentView[] | null>(() => parseInitial(initial));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorKey | null>(() =>
    parseInitial(initial) === null ? 'loadFailed' : null,
  );
  const [notice, setNotice] = useState(false);

  const replace = (agentId: string, patch: Partial<AgentView>) =>
    setAgents((list) => (list ?? []).map((a) => (a.agentId === agentId ? { ...a, ...patch } : a)));

  const onSetSubject = async (agent: AgentView, subject: 'investing' | 'health' | 'law' | null) => {
    setError(null);
    setNotice(false);
    setBusy({ kind: 'subject', agentId: agent.agentId });
    try {
      const result = await setSubject({ agentId: agent.agentId, subject });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      replace(agent.agentId, { regulatedSubject: subject, approvedAt: null, approvedBy: null });
      setNotice(true);
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const onSetApproval = async (agent: AgentView, approved: boolean) => {
    setError(null);
    setNotice(false);
    setBusy({ kind: 'approval', agentId: agent.agentId });
    try {
      const result = await setApproval({ agentId: agent.agentId, approved });
      if (!result.ok) {
        setError(errorKey(result.code));
        return;
      }
      replace(agent.agentId, {
        approvedAt: approved ? new Date().toISOString() : null,
        approvedBy: approved ? agent.approvedBy : null,
      });
      setNotice(true);
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const onReload = async () => {
    setError(null);
    setNotice(false);
    setBusy({ kind: 'reload' });
    try {
      const result = await loadAgents();
      if (!result.ok) {
        setError('loadFailed');
        return;
      }
      setAgents(result.agents);
    } catch {
      setError('loadFailed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="staff-agents">
      <p>{t('intro')}</p>
      {error ? (
        <p role="alert" className="staff-agents-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="staff-agents-notice">
          {t('saved')}
        </p>
      ) : null}
      <p>
        <button type="button" disabled={busy !== null} onClick={() => void onReload()}>
          {busy?.kind === 'reload' ? t('reloading') : t('reload')}
        </button>
      </p>
      {agents === null ? null : agents.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="staff-agents-list" aria-label={t('listLabel')}>
          {agents.map((agent) => (
            <AgentRow
              key={`${agent.agentId}:${agent.regulatedSubject ?? ''}:${agent.approvedAt ?? ''}`}
              agent={agent}
              pending={busy !== null && busy.kind !== 'reload' && busy.agentId === agent.agentId ? busy.kind : null}
              disabled={busy !== null}
              onSetSubject={(subject) => void onSetSubject(agent, subject)}
              onSetApproval={(approved) => void onSetApproval(agent, approved)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
