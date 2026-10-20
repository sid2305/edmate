import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertNotAnswerBank } from '../src/answerBank.js';
import { parseMarkdown } from '../src/parse/markdown.js';
import { IngestError } from '../src/errors.js';

const MODULES = ['conditions', 'functions', 'lists-dicts', 'loops', 'values-variables'] as const;
const CONTENT_ROOT = '../../content/demo-teacher/';

function parsedFrom(relativePath: string, sourceTitle: string) {
  const bytes = readFileSync(CONTENT_ROOT + relativePath);
  return parseMarkdown(bytes, sourceTitle);
}

describe('assertNotAnswerBank', () => {
  it.each(MODULES)('refuses the demo question-bank/%s.yaml', (name) => {
    const title = `question-bank/${name}.yaml`;
    const doc = parsedFrom(`question-bank/${name}.yaml`, title);
    expect(() => {
      assertNotAnswerBank(title, doc.units);
    }).toThrow(IngestError);
  });

  it.each(MODULES)('refuses the demo rubric-answers/%s.yaml', (name) => {
    const title = `rubric-answers/${name}.yaml`;
    const doc = parsedFrom(`rubric-answers/${name}.yaml`, title);
    expect(() => {
      assertNotAnswerBank(title, doc.units);
    }).toThrow(IngestError);
  });

  it.each(MODULES)('passes the demo modules/%s/notes.md', (name) => {
    const title = `modules/${name}/notes.md`;
    const doc = parsedFrom(`modules/${name}/notes.md`, title);
    expect(() => {
      assertNotAnswerBank(title, doc.units);
    }).not.toThrow();
  });

  it('refuses a title naming a question-bank path, regardless of content', () => {
    expect(() => {
      assertNotAnswerBank('question-bank/loops.yaml', [
        { text: 'A for loop runs once per item.', locator: 'page 1' },
      ]);
    }).toThrow(IngestError);
  });

  it('refuses a title naming a rubric-answers path with a backslash separator', () => {
    expect(() => {
      assertNotAnswerBank('rubric-answers\\x.yml', [
        { text: 'A for loop runs once per item.', locator: 'page 1' },
      ]);
    }).toThrow(IngestError);
  });

  it('refuses any .yaml file name, even with no bank path segment', () => {
    expect(() => {
      assertNotAnswerBank('bank.yaml', [
        { text: 'A for loop runs once per item.', locator: 'page 1' },
      ]);
    }).toThrow(IngestError);
  });

  it('does not refuse a worksheet with a single capitalised Answer line', () => {
    expect(() => {
      assertNotAnswerBank('worksheet.md', [
        { text: 'Q1. What is 3 + 4?\nAnswer: 7', locator: 'page 1' },
      ]);
    }).not.toThrow();
  });

  it('does not refuse a lowercase "answer:" alone, without a matching "question:"', () => {
    expect(() => {
      assertNotAnswerBank('worksheet.md', [
        { text: 'Q1. What is 3 + 4?\nanswer: 7', locator: 'page 1' },
      ]);
    }).not.toThrow();
  });

  it('refuses a source whose units together have the QuestionBankItem shape', () => {
    expect(() => {
      assertNotAnswerBank('My Notes', [
        { text: 'id: q1 question: What is a loop?', locator: 'page 1' },
        { text: 'answer: A block of code that repeats.', locator: 'page 2' },
      ]);
    }).toThrow(IngestError);
  });

  it('refuses a source whose units together have the RubricAnswer shape', () => {
    expect(() => {
      assertNotAnswerBank('My Notes', [
        { text: 'studentAnswer: 7', locator: 'page 1' },
        { text: 'rubricNotes: correct', locator: 'page 2' },
      ]);
    }).toThrow(IngestError);
  });

  it('throws an error whose JSON carries no input text', () => {
    try {
      assertNotAnswerBank('question-bank/secret.yaml', [
        { text: 'question: do-not-leak-this-text answer: 42', locator: 'page 1' },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      const json = JSON.stringify((error as IngestError).toJSON());
      expect(json).not.toContain('do-not-leak-this-text');
      expect(json).not.toContain('secret.yaml');
    }
  });
});
