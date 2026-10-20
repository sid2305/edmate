// Test-only locale pack for the distress cases (task 4.3). The real per-market packs come with
// 3.10; LocalePack itself is unchanged. Tele-MANAS 14416 is India's public mental-health line
// (docs/edmate-prd.md line 270), which the `distress/in` eval cases expect in the reply.
import type { LocalePack } from '@edmate/contracts';
import { demoLocalePack } from '@edmate/contracts/fixtures';

export const indiaLocalePackWithHelplines: LocalePack = {
  ...demoLocalePack,
  helplines: [
    {
      name: 'Tele-MANAS',
      number: '14416',
      kind: 'mental_health',
      verifiedBy: 'test pack',
      verifiedOn: '2026-01-01',
    },
  ],
};
