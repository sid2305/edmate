// Task 9.4 Phase C: asks for a hint (`kind: 'hint_request'`) and shows the last rung of help the
// tutor gave: 1-2 "Hint", 3 "Worked example", 4 "Full solution"; anything else shows nothing.
import { useTranslations } from 'next-intl';

const RUNG_KEYS = { 1: 'rung1', 2: 'rung2', 3: 'rung3', 4: 'rung4' } as const;

function rungKey(rung: number | null) {
  return rung === 1 || rung === 2 || rung === 3 || rung === 4 ? RUNG_KEYS[rung] : null;
}

export interface HintButtonProps {
  rung: number | null;
  disabled: boolean;
  onHint: () => void;
}

export function HintButton({ rung, disabled, onHint }: HintButtonProps) {
  const t = useTranslations('chat');
  const key = rungKey(rung);
  return (
    <div className="chat-hint">
      <button type="button" disabled={disabled} onClick={onHint}>
        {t('hint')}
      </button>
      {key === null ? null : <span className="chat-rung">{t('lastHelp', { level: t(key) })}</span>}
    </div>
  );
}
