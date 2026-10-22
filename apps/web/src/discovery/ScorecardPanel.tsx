// Task 9.2 Phase C: the teaching scorecard on the public teacher page (PRD S14). `null` is the
// honest "no published scorecard yet" state -- never zeros. A category with no measured percent
// says "not measured yet", never 0%.
import type { Translate } from './format';
import type { PublicScorecard } from './scorecard';

export interface ScorecardPanelProps {
  scorecard: PublicScorecard | null;
  /** next-intl translator for the `teacherPage` namespace. */
  t: Translate;
}

export function ScorecardPanel({ scorecard, t }: ScorecardPanelProps) {
  return (
    <section aria-labelledby="teacher-scorecard-heading">
      <h2 id="teacher-scorecard-heading">{t('scorecardHeading')}</h2>
      {scorecard === null ? (
        <p>{t('scorecardNone')}</p>
      ) : (
        <dl className="scorecard">
          {scorecard.categories.map((c) => (
            <div key={c.key}>
              <dt>{t(`scorecardCategories.${c.key}`)}</dt>
              {c.measured && c.percent !== null ? (
                <>
                  <dd>{t('scorecardPercent', { percent: c.percent })}</dd>
                  <dd>{c.pass ? t('scorecardPassed') : t('scorecardNotPassed')}</dd>
                </>
              ) : (
                <dd>{t('scorecardNotMeasured')}</dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
