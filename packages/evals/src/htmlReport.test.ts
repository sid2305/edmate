import { describe, expect, it } from 'vitest';
import { toHtmlReport } from './htmlReport.js';
import { toJsonReport } from './report.js';
import type { CaseResult } from './runner.js';

const results: CaseResult[] = [
  { id: 'test-explain-001', suite: 'test', pass: true, turns: [] },
  {
    id: 'test-locked-002',
    suite: 'test',
    pass: false,
    turns: [
      {
        turnIndex: 0,
        student: 'Please',
        reply: 'Fine: lesson 9 says...',
        checks: [{ name: 'must_not_contain', pass: false, detail: 'found: "lesson 9"' }],
        pass: false,
      },
    ],
  },
  { id: 'test-errored-003', suite: 'test', pass: false, error: 'boom', turns: [] },
];

describe('toHtmlReport', () => {
  it('renders a static page with no script and no external URL', () => {
    const html = toHtmlReport(toJsonReport(results, { suite: 'test' }));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).toContain('<style>');
    expect(html).toMatchSnapshot();
  });

  it('renders a calibration block when the report carries one', () => {
    const html = toHtmlReport(
      toJsonReport(results, {
        suite: 'test',
        calibration: { sampled: 1, reviewed: 1, agreed: 1, rate: 1, disagreements: [] },
      }),
    );
    expect(html).toContain('Human double-check');
    expect(html).toMatchSnapshot();
  });

  it('omits the calibration block when the report carries none', () => {
    const html = toHtmlReport(toJsonReport(results, { suite: 'test' }));
    expect(html).not.toContain('Human double-check');
  });

  it('escapes a hostile case id, reply text and check detail', () => {
    const hostile: CaseResult[] = [
      {
        id: 'test-explain-001',
        suite: '<img src=x onerror=alert(1)>',
        pass: false,
        turns: [
          {
            turnIndex: 0,
            student: 's',
            reply: 'r',
            checks: [
              {
                name: '<script>alert(1)</script>',
                pass: false,
                detail: '"><script>alert(1)</script> javascript:alert(1)',
              },
            ],
            pass: false,
          },
        ],
      },
    ];
    const html = toHtmlReport(toJsonReport(hostile, { suite: '<script>alert(2)</script>' }));
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('javascript:alert(1)'); // plain text content, never an href
    expect(html).not.toMatch(/href\s*=\s*["']?javascript:/);
  });

  it('escapes a hostile calibration disagreement id', () => {
    const html = toHtmlReport(
      toJsonReport(results, {
        suite: 'test',
        calibration: {
          sampled: 1,
          reviewed: 1,
          agreed: 0,
          rate: 0,
          disagreements: ['<script>alert(3)</script>'],
        },
      }),
    );
    expect(html).not.toContain('<script>alert(3)');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
  });
});
