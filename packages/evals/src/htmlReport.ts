// A static, self-contained HTML eval report (task 7.1). No `<script>`, no remote asset, every
// dynamic value HTML-escaped: this page is never a vector for the cases or replies it renders.
import type { JsonReport } from './report.js';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstFailingCheck(caseResult: JsonReport['cases'][number]): string {
  if (caseResult.error !== undefined) return `error: ${caseResult.error}`;
  const turn = caseResult.turns.find((t) => !t.pass);
  const check = turn?.checks.find((c) => !c.pass);
  if (check === undefined) return '';
  return check.detail === undefined ? check.name : `${check.name}: ${check.detail}`;
}

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  .pass { color: #0a7a0a; }
  .fail { color: #b00020; }
`;

export function toHtmlReport(report: JsonReport): string {
  const rows = report.cases
    .map((c) => {
      const status = c.pass ? 'pass' : 'fail';
      return `      <tr>
        <td>${esc(c.id)}</td>
        <td>${esc(c.suite)}</td>
        <td class="${status}">${c.pass ? 'pass' : 'fail'}</td>
        <td>${esc(firstFailingCheck(c))}</td>
      </tr>`;
    })
    .join('\n');

  const calibration = report.calibration;
  const calibrationBlock =
    calibration === undefined
      ? ''
      : `
    <h2>Human double-check</h2>
    <ul>
      <li>sampled: ${calibration.sampled}</li>
      <li>reviewed: ${calibration.reviewed}</li>
      <li>agreed: ${calibration.agreed}</li>
      <li>rate: ${(calibration.rate * 100).toFixed(1)}%</li>
      ${
        calibration.disagreements.length === 0
          ? ''
          : `<li>disagreements: ${calibration.disagreements.map((id) => esc(id)).join(', ')}</li>`
      }
    </ul>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Eval report${report.suite === undefined ? '' : `: ${esc(report.suite)}`}</title>
  <style>${STYLE}</style>
</head>
<body>
  <h1>Eval report${report.suite === undefined ? '' : `: ${esc(report.suite)}`}</h1>
  <p>${report.passed}/${report.total} passed${
    report.judgeModel === undefined ? '' : ` &middot; judge: ${esc(report.judgeModel)}`
  }${report.generatedAt === undefined ? '' : ` &middot; generated: ${esc(report.generatedAt)}`}</p>
  <table>
    <thead>
      <tr><th>id</th><th>suite</th><th>status</th><th>first failing check</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>${calibrationBlock}
</body>
</html>
`;
}
