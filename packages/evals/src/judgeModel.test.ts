import { describe, expect, it } from 'vitest';
import { JudgeModelConfigError, judgeModelLabel, resolveJudgeModel } from './judgeModel.js';

describe('resolveJudgeModel', () => {
  it('parses provider:model', () => {
    expect(resolveJudgeModel({ EDMATE_JUDGE_MODEL: 'anthropic:claude-x' })).toEqual({
      provider: 'anthropic',
      model: 'claude-x',
    });
  });

  it('keeps colons after the first one in the model id', () => {
    expect(resolveJudgeModel({ EDMATE_JUDGE_MODEL: 'openai-compatible:org/m:free' })).toEqual({
      provider: 'openai-compatible',
      model: 'org/m:free',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(resolveJudgeModel({ EDMATE_JUDGE_MODEL: '  anthropic:m  ' }).model).toBe('m');
  });

  it.each([[undefined], [''], ['   ']])('throws naming the variable when unset (%j)', (v) => {
    expect(() => resolveJudgeModel({ EDMATE_JUDGE_MODEL: v })).toThrow(JudgeModelConfigError);
    expect(() => resolveJudgeModel({ EDMATE_JUDGE_MODEL: v })).toThrow(/EDMATE_JUDGE_MODEL/);
  });

  it.each([['anthropic'], [':model'], ['anthropic:'], ['anthropic: ']])(
    'throws on a malformed value %j',
    (v) => {
      expect(() => resolveJudgeModel({ EDMATE_JUDGE_MODEL: v })).toThrow(/<provider>:<model>/);
    },
  );

  it('reads process.env by default', () => {
    const before = process.env['EDMATE_JUDGE_MODEL'];
    process.env['EDMATE_JUDGE_MODEL'] = 'anthropic:from-env';
    try {
      expect(resolveJudgeModel().model).toBe('from-env');
    } finally {
      if (before === undefined) delete process.env['EDMATE_JUDGE_MODEL'];
      else process.env['EDMATE_JUDGE_MODEL'] = before;
    }
  });

  it('labels a config as provider:model', () => {
    expect(judgeModelLabel({ provider: 'anthropic', model: 'm' })).toBe('anthropic:m');
  });
});
