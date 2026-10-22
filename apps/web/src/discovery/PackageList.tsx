// Task 9.2 Phase C: a live agent's live packages on the public teacher page. Server-rendered,
// public `PackageOffer` fields only (name, price, trial, daily messages, live classes, skills);
// teacher-written text renders as plain React text (scope decision 5). No ids reach the markup.
import type { PackageOffer } from '@edmate/db';
import { formatPrice, type Translate } from './format';

export interface PackageListProps {
  packages: readonly PackageOffer[];
  /** next-intl translator for the `teacherPage` namespace. */
  t: Translate;
}

export function PackageList({ packages, t }: PackageListProps) {
  if (packages.length === 0) return <p>{t('noPackages')}</p>;
  return (
    <ul className="package-list">
      {packages.map((offer) => (
        <li key={offer.packageId}>
          <h3>{offer.name}</h3>
          <p>
            {offer.pricePerMonth.amountMinor === 0
              ? t('free')
              : t('pricePerMonth', { price: formatPrice(offer.pricePerMonth, t('free')) })}
          </p>
          {offer.trialDays > 0 ? <p>{t('trialDays', { days: offer.trialDays })}</p> : null}
          <p>{t('dailyMessageLimit', { count: offer.dailyMessageLimit })}</p>
          <p>{t('liveClassesPerMonth', { count: offer.liveClassesPerMonth })}</p>
          {offer.skills.length > 0 ? (
            <>
              <p>{t('skillsLabel')}</p>
              <ul>
                {offer.skills.map((skill) => (
                  <li key={skill}>{t(`skills.${skill}`)}</li>
                ))}
              </ul>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
