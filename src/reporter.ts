import chalk from 'chalk';
import type { EvalReport, EvalResult } from './config.js';

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function scoreColor(score: number): (text: string) => string {
  if (score >= 70) return chalk.green;
  if (score >= 40) return chalk.yellow;
  return chalk.red;
}

function printTable(reports: EvalReport[]): void {
  const modelWidth = Math.max(20, ...reports.map(r => r.modelId.length)) + 2;
  const triggerWidth = 14;
  const complianceWidth = 16;
  const overallWidth = 9;

  const line = (left: string, mid: string, right: string, fill: string) =>
    left + fill.repeat(modelWidth) + mid + fill.repeat(triggerWidth) + mid + fill.repeat(complianceWidth) + mid + fill.repeat(overallWidth) + right;

  console.log(line('┌', '┬', '┐', '─'));
  console.log(
    '│' + padRight(' Model', modelWidth) +
    '│' + padRight(' Trigger', triggerWidth) +
    '│' + padRight(' Compliance', complianceWidth) +
    '│' + padRight(' Overall', overallWidth) + '│',
  );
  console.log(line('├', '┼', '┤', '─'));

  for (const report of reports) {
    const triggerStr = `${report.triggerScore.correct}/${report.triggerScore.total}`;
    const complianceStr = report.complianceScore.total > 0
      ? `${report.complianceScore.correct}/${report.complianceScore.total} (${report.complianceScore.avgScore})`
      : 'N/A';
    const overallStr = `${report.overall}%`;
    const color = scoreColor(report.overall);

    console.log(
      '│' + padRight(` ${report.modelId}`, modelWidth) +
      '│' + padRight(` ${triggerStr}`, triggerWidth) +
      '│' + padRight(` ${complianceStr}`, complianceWidth) +
      '│' + color(padRight(` ${overallStr}`, overallWidth)) + '│',
    );
  }

  console.log(line('└', '┴', '┘', '─'));

  if (reports.length > 0) {
    const best = reports[0];
    const worst = reports[reports.length - 1];
    console.log(`\n${chalk.green('Best model:')} ${best.modelId} (${best.overall}%)`);
    if (reports.length > 1) {
      console.log(`${chalk.red('Worst model:')} ${worst.modelId} (${worst.overall}%)`);
    }
  }
}

function printVerbose(evalResults: EvalResult[]): void {
  const byModel = new Map<string, EvalResult[]>();
  for (const result of evalResults) {
    const arr = byModel.get(result.modelId) ?? [];
    arr.push(result);
    byModel.set(result.modelId, arr);
  }

  for (const [modelId, results] of byModel) {
    console.log(`\n${chalk.bold(`--- ${modelId} ---`)}`);
    for (const result of results) {
      const status = result.trigger.correct ? chalk.green('PASS') : chalk.red('FAIL');
      console.log(`  [${status}] ${result.prompt.type}: "${result.prompt.text.slice(0, 60)}"`);
      console.log(`         ${result.trigger.reason}`);
      if (result.compliance) {
        const compStatus = result.compliance.compliant ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(`    Compliance: [${compStatus}] ${result.compliance.score}/100 — ${result.compliance.reason}`);
      }
    }
  }
}

export function printReport(
  reports: EvalReport[],
  evalResults: EvalResult[],
  options: { json: boolean; verbose: boolean },
): void {
  if (options.json) {
    console.log(JSON.stringify({ reports, evalResults }, null, 2));
    return;
  }

  printTable(reports);

  if (options.verbose) {
    printVerbose(evalResults);
  } else {
    console.log(`\nRun with ${chalk.cyan('--verbose')} to see individual test results.`);
    console.log(`Run with ${chalk.cyan('--json')} to get machine-readable output.`);
  }
}
