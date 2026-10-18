import type { AgentConfig, PackageConfig, StyleCard } from '../../src/index.js';
import { modelPolicyFull, modelPolicyMinimal } from './model.js';
import { moneyFree, moneyPaid } from './shared.js';

export const demoAgentConfig = {
  id: 'agt_test_01',
  version: 3,
  teacherId: 'tch_test_01',
  courseId: 'crs_test_01',
  styleCardId: 'sty_test_01',
  promptPackVersion: '1.0.0',
  languages: ['en', 'hi'],
  modelPolicy: modelPolicyMinimal,
} satisfies AgentConfig;

export const demoAgentConfigRegulated = {
  ...demoAgentConfig,
  id: 'agt_test_02',
  promptPackVersion: '2.1.0-rc.1',
  regulatedSubject: 'investing',
  modelPolicy: modelPolicyFull,
} satisfies AgentConfig;

export const demoStyleCard = {
  id: 'sty_test_01',
  teacherId: 'tch_test_01',
  version: 1,
  text: 'Warm and brief. Always ask what the student already tried. Use everyday examples. Never shame a mistake.',
  mistakeTags: ['sign_error', 'unit_missing'],
} satisfies StyleCard;

/** Exactly at the limit: 300 words. */
export const styleCardAtLimit = {
  ...demoStyleCard,
  id: 'sty_test_02',
  text: Array.from({ length: 300 }, () => 'word').join(' '),
  mistakeTags: [],
} satisfies StyleCard;

export const demoPackageFree = {
  id: 'pkg_test_free',
  version: 1,
  teacherId: 'tch_test_01',
  agentId: 'agt_test_01',
  name: 'Free',
  moduleIds: ['mod_test_01'],
  skills: ['explain', 'coach'],
  helpCeiling: 2,
  finalAnswers: 'never',
  dailyMessageLimit: 20,
  liveClassesPerMonth: 0,
  pricePerMonth: moneyFree,
  lockedReply: 'name_package',
} satisfies PackageConfig;

export const demoPackagePaid = {
  id: 'pkg_test_paid',
  version: 2,
  teacherId: 'tch_test_01',
  agentId: 'agt_test_01',
  name: 'Full course',
  moduleIds: ['mod_test_01', 'mod_test_02', 'mod_test_03'],
  skills: ['explain', 'coach', 'practice', 'feedback', 'revision'],
  helpCeiling: 4,
  finalAnswers: 'after_attempt',
  dailyMessageLimit: 100,
  liveClassesPerMonth: 2,
  pricePerMonth: moneyPaid,
  trialDays: 7,
  lockedReply: 'generic',
} satisfies PackageConfig;

export const valid = {
  AgentConfig: [demoAgentConfig, demoAgentConfigRegulated],
  StyleCard: [demoStyleCard, styleCardAtLimit],
  PackageConfig: [
    demoPackageFree,
    demoPackagePaid,
    {
      ...demoPackageFree,
      id: 'pkg_test_open',
      finalAnswers: 'allowed',
      helpCeiling: 1,
    } satisfies PackageConfig,
  ],
};
