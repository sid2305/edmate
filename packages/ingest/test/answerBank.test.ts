import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertNotAnswerBank } from '../src/answerBank.js';
import { parseMarkdown } from '../src/parse/markdown.js';
import { IngestError } from '../src/errors.js';

const MODULES = ['conditions', 'functions', 'lists-dicts', 'loops', 'values-variables'] as const;
const CONTENT_ROOT = new URL('../../../content/demo-teacher/', import.meta.url);

function bankBytes(relativePath: string): Uint8Array {
  return readFileSync(new URL(relativePath, CONTENT_ROOT));
}

function parsedFrom(relativePath: string, sourceTitle: string) {
  const bytes = bankBytes(relativePath);
  return { doc: parseMarkdown(bytes, sourceTitle), raw: new TextDecoder().decode(bytes) };
}

describe('assertNotAnswerBank', () => {
  it.each(MODULES)('refuses the demo question-bank/%s.yaml', (name) => {
    const title = `question-bank/${name}.yaml`;
    const { doc, raw } = parsedFrom(`question-bank/${name}.yaml`, title);
    expect(() => {
      assertNotAnswerBank(title, doc.units, raw);
    }).toThrow(IngestError);
  });

  it.each(MODULES)('refuses the demo rubric-answers/%s.yaml', (name) => {
    const title = `rubric-answers/${name}.yaml`;
    const { doc, raw } = parsedFrom(`rubric-answers/${name}.yaml`, title);
    expect(() => {
      assertNotAnswerBank(title, doc.units, raw);
    }).toThrow(IngestError);
  });

  it.each(MODULES)(
    'refuses the demo question-bank/%s.yaml content under a neutral title (shape rule)',
    (name) => {
      const { doc, raw } = parsedFrom(`question-bank/${name}.yaml`, 'notes.md');
      expect(() => {
        assertNotAnswerBank('notes.md', doc.units, raw);
      }).toThrow(IngestError);
    },
  );

  it.each(MODULES)(
    'refuses the demo rubric-answers/%s.yaml content under a neutral title (shape rule)',
    (name) => {
      const { doc, raw } = parsedFrom(`rubric-answers/${name}.yaml`, 'notes.md');
      expect(() => {
        assertNotAnswerBank('notes.md', doc.units, raw);
      }).toThrow(IngestError);
    },
  );

  it.each(MODULES)('passes the demo modules/%s/notes.md', (name) => {
    const title = `modules/${name}/notes.md`;
    const { doc, raw } = parsedFrom(`modules/${name}/notes.md`, title);
    expect(() => {
      assertNotAnswerBank(title, doc.units, raw);
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

  it('refuses a title naming a Question-Bank path case-insensitively', () => {
    expect(() => {
      assertNotAnswerBank('Question-Bank/x.md', [
        { text: 'A for loop runs once per item.', locator: 'page 1' },
      ]);
    }).toThrow(IngestError);
  });

  it('refuses a title naming a RUBRIC-ANSWERS path case-insensitively with a backslash', () => {
    expect(() => {
      assertNotAnswerBank('RUBRIC-ANSWERS\\x.md', [
        { text: 'A for loop runs once per item.', locator: 'page 1' },
      ]);
    }).toThrow(IngestError);
  });

  it('refuses a title whose .yaml suffix carries a trailing zero-width character', () => {
    expect(() => {
      assertNotAnswerBank('bank.yaml​', [
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

  it('refuses a source whose units together have the QuestionBankItem shape (no raw lines)', () => {
    expect(() => {
      assertNotAnswerBank('My Notes', [
        { text: 'id: q1 question: What is a loop?', locator: 'page 1' },
        { text: 'answer: A block of code that repeats.', locator: 'page 2' },
      ]);
    }).toThrow(IngestError);
  });

  it('refuses a source whose units together have the RubricAnswer shape (no raw lines)', () => {
    expect(() => {
      assertNotAnswerBank('My Notes', [
        { text: 'studentAnswer: 7', locator: 'page 1' },
        { text: 'rubricNotes: correct', locator: 'page 2' },
      ]);
    }).toThrow(IngestError);
  });

  it('refuses quoted YAML keys ("question": / "answer":) on raw lines', () => {
    const raw = '"question": What is x?\n"answer": 7\n';
    expect(() => {
      assertNotAnswerBank('notes.md', [{ text: raw, locator: 'page 1' }], raw);
    }).toThrow(IngestError);
  });

  it('refuses a key with a space before the colon ("question :") on raw lines', () => {
    const raw = 'question : What is x?\nanswer: 7\n';
    expect(() => {
      assertNotAnswerBank('notes.md', [{ text: raw, locator: 'page 1' }], raw);
    }).toThrow(IngestError);
  });

  it('refuses a key carrying a zero-width character inside it ("ans\\u200bwer:") on raw lines', () => {
    const raw = 'question: What is x?\nans​wer: 7\n';
    expect(() => {
      assertNotAnswerBank('notes.md', [{ text: raw, locator: 'page 1' }], raw);
    }).toThrow(IngestError);
  });

  it('refuses a fullwidth "question:" key (NFKC-folded) on raw lines', () => {
    const raw = 'ｑｕｅｓｔｉｏｎ: What is x?\nanswer: 7\n';
    expect(() => {
      assertNotAnswerBank('notes.md', [{ text: raw, locator: 'page 1' }], raw);
    }).toThrow(IngestError);
  });

  it('refuses an indented YAML list item ("  - question: ...") on raw lines', () => {
    const raw = '- id: q1\n  question: What is x?\n  answer: 7\n';
    expect(() => {
      assertNotAnswerBank('notes.md', [{ text: raw, locator: 'page 1' }], raw);
    }).toThrow(IngestError);
  });

  it('does not refuse prose that mentions "question:" and "answer:" mid-sentence, on raw lines', () => {
    const raw = 'In this lesson we cover a question: what is x? and the answer: it depends.\n';
    expect(() => {
      assertNotAnswerBank('worksheet.md', [{ text: raw, locator: 'page 1' }], raw);
    }).not.toThrow();
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

  // 8.x scope (not closed here): a compact single-line JSON array bank has no line that starts
  // with a bare "question:"/"answer:" key (the key sits after "{" on the same line), so the raw-line
  // shape rule does not catch it. Left for the upload scope (task 8.x), per the 5.6c plan.
  it('does not refuse a compact JSON array bank (documented gap, 8.x)', () => {
    const raw = '[{"question": "What is x?", "answer": "7"}]\n';
    expect(() => {
      assertNotAnswerBank('notes.md', [{ text: raw, locator: 'page 1' }], raw);
    }).not.toThrow();
  });

  // 8.x scope (not closed here): a markdown table's header/body rows start with "|", not with the
  // key, so the raw-line shape rule does not catch a table-shaped bank either.
  it('does not refuse a markdown table bank (documented gap, 8.x)', () => {
    const raw = '| question | answer |\n| --- | --- |\n| What is x? | 7 |\n';
    expect(() => {
      assertNotAnswerBank('notes.md', [{ text: raw, locator: 'page 1' }], raw);
    }).not.toThrow();
  });
});
