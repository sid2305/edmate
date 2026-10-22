// Task 9.5b: shown only while the mock interview is the active skill. Pause and Stop send
// ordinary `message` turns with the literal text `/pause` and `stop` (`rolePlayControl`'s own
// parsing, unchanged -- these are chat text, not a new turn kind). `ChatView` wires the actual
// text and `skill: 'mock_interview'` tag onto the request; this component only raises the intent.
import { useTranslations } from 'next-intl';

export interface MockInterviewControlsProps {
  disabled: boolean;
  onPause: () => void;
  onStop: () => void;
}

export function MockInterviewControls({ disabled, onPause, onStop }: MockInterviewControlsProps) {
  const t = useTranslations('chat');
  return (
    <div className="chat-mock-interview-controls">
      <button type="button" disabled={disabled} onClick={onPause}>
        {t('mockInterview.pause')}
      </button>
      <button type="button" disabled={disabled} onClick={onStop}>
        {t('mockInterview.stop')}
      </button>
    </div>
  );
}
