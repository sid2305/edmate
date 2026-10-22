// Eval runner (task 3.12): YAML multi-turn cases, string and structure checks, judge scoring,
// record / replay of agent replies and judge outputs.
export {
  EvalAgentReplySchema,
  type EvalAgent,
  type EvalAgentReply,
  type EvalTurnInput,
  type PriorTurn,
} from './agent.js';
export {
  computeAgreement,
  DoubleCheckLoadError,
  HumanVerdictSchema,
  loadDoubleCheck,
  sampleForDoubleCheck,
  type CalibrationSummary,
  type HumanVerdict,
} from './calibration.js';
export { buildJudgeRequest, judge, JudgeVerdictSchema, type JudgeVerdict } from './checks/judge.js';
export type { CheckResult } from './checks/result.js';
export { checkMatches, checkMustContain, checkMustNotContain } from './checks/string.js';
export {
  checkMaxChars,
  checkMaxWords,
  checkMustCiteSource,
  checkMustBlock,
  checkMustEscalate,
  countChars,
  countWords,
} from './checks/structure.js';
export {
  JUDGE_MODEL_VARIABLE,
  JudgeModelConfigError,
  judgeModelLabel,
  resolveJudgeModel,
  type JudgeModelConfig,
} from './judgeModel.js';
export {
  CaseLoadError,
  NoCasesFoundError,
  loadCasesFromDir,
  loadCasesWithFiles,
  type LoadedCaseFile,
} from './loader.js';
export {
  LiveModelEntrySchema,
  LiveModelsLoadError,
  loadLiveModels,
  type LiveModelEntry,
} from './liveModels.js';
export {
  fileRecorder,
  FixtureReadError,
  InvalidFixtureKeyError,
  memoryRecorder,
  MissingFixtureError,
  type MemoryRecorder,
  type Recorder,
  type RecordMode,
} from './recorder.js';
export {
  generatePerAgentSuite,
  LOCKED_TEMPLATES,
  PerAgentSuiteError,
  type AgentPackage,
  type AnswerableItem,
  type ItemProvenance,
  type LockedTemplate,
  type OutOfCourseItem,
  type PerAgentSuiteInput,
} from './perAgentSuite.js';
export { toJsonReport, toSummary, type JsonReport, type ReportCost } from './report.js';
export { toHtmlReport } from './htmlReport.js';
export {
  RecordedJudgeSchema,
  runCase,
  runSuite,
  type CaseResult,
  type RunOptions,
  type SuiteResult,
  type TurnResult,
} from './runner.js';
export {
  CheckSchema,
  EvalCaseSchema,
  EvalSkillSchema,
  TurnSchema,
  type Checks,
  type EvalCase,
  type EvalSkill,
  type EvalTurn,
} from './schema.js';
