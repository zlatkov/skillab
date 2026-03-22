#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { parseSkill } from './parser.js';
import { createModel, resolveApiKey } from './providers.js';
import { generateTestPrompts } from './test-generator.js';
import { runTests } from './runner.js';
import { evaluateResults, computeReport } from './evaluator.js';
import { printReport } from './reporter.js';
import {
  DEFAULT_FREE_MODELS,
  DEFAULT_GENERATOR_MODELS,
  DEFAULT_JUDGE_MODELS,
  PROVIDER_NAMES,
  type ModelWithId,
  type ProviderName,
} from './config.js';

const program = new Command();

program
  .name('skilleval')
  .description('Evaluate how well AI models understand Agent Skills (SKILL.md files)')
  .version('0.1.0')
  .argument('<skill>', 'Path, URL, or GitHub shorthand (owner/repo) to a SKILL.md file')
  .option('-p, --provider <provider>', 'Provider: openrouter, anthropic, openai, google', 'openrouter')
  .option('-m, --models <models>', 'Comma-separated model IDs to test')
  .option('-k, --key <key>', 'API key (or use provider-specific env var)')
  .option('--generator-model <model>', 'Model for test prompt generation (comma-separated for fallbacks)')
  .option('--judge-model <model>', 'Model for evaluation judging (comma-separated for fallbacks)')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Show detailed per-prompt results', false)
  .option('--prompts <path>', 'Path to JSON file with custom test prompts')
  .option('-s, --skill <name>', 'Skill name within the repo (looks for skills/<name>/SKILL.md)')
  .option('-n, --count <number>', 'Number of positive+negative test prompts (default: 5+5)', '5')
  .action(async (skillSource: string, opts) => {
    try {
      const provider = opts.provider as ProviderName;
      if (!PROVIDER_NAMES.includes(provider)) {
        console.error(chalk.red(`Invalid provider "${provider}". Must be one of: ${PROVIDER_NAMES.join(', ')}`));
        process.exit(1);
      }

      // Resolve API key for the test models
      let apiKey: string;
      try {
        apiKey = resolveApiKey(provider, opts.key);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }

      // Resolve model IDs
      const modelIds = opts.models
        ? (opts.models as string).split(',').map((m: string) => m.trim())
        : (provider === 'openrouter' ? DEFAULT_FREE_MODELS : []);

      if (modelIds.length === 0) {
        console.error(chalk.red('No models specified. Use --models or default to openrouter provider for free models.'));
        process.exit(1);
      }

      // Resolve generator/judge keys (always OpenRouter for internal models)
      let internalApiKey: string;
      try {
        internalApiKey = resolveApiKey('openrouter', provider === 'openrouter' ? apiKey : undefined);
      } catch {
        if (!opts.prompts) {
          console.error(chalk.red(
            'OPENROUTER_API_KEY is required for test generation and evaluation (uses free models).\n' +
            'Set OPENROUTER_API_KEY env var, or provide custom prompts with --prompts.',
          ));
          process.exit(1);
        }
        internalApiKey = '';
      }

      // Parse skill
      process.stderr.write(chalk.cyan('Parsing skill...\n'));
      const skill = await parseSkill(skillSource, opts.skill);

      if (!opts.json) {
        console.log(`\n${chalk.bold('skilleval')} v0.1.0`);
        console.log(`${chalk.bold('Skill:')} ${skill.name}`);
        console.log(`${chalk.bold('Description:')} ${skill.description}`);
        console.log(`${chalk.bold('Provider:')} ${provider}`);
        console.log(`${chalk.bold('Models:')} ${modelIds.length}\n`);
      }

      // Create model instances
      const models: ModelWithId[] = modelIds.map(id => ({
        model: createModel(provider, id, apiKey),
        modelId: id,
      }));

      // Generate test prompts
      process.stderr.write(chalk.cyan('Generating test prompts...\n'));
      const generatorModelIds = opts.generatorModel
        ? (opts.generatorModel as string).split(',').map((m: string) => m.trim())
        : DEFAULT_GENERATOR_MODELS;
      const generatorModels = generatorModelIds.map(id => createModel('openrouter', id, internalApiKey));
      const count = parseInt(opts.count, 10);
      const prompts = await generateTestPrompts(skill, generatorModels, count, opts.prompts, opts.verbose);
      process.stderr.write(chalk.green(`  Generated ${prompts.length} test prompts\n\n`));

      // Run trigger tests
      process.stderr.write(chalk.cyan('Running trigger tests...\n'));
      const testResults = await runTests(skill, prompts, models, opts.verbose);

      // Evaluate results
      process.stderr.write(chalk.cyan('Evaluating results...\n'));
      const judgeModelIds = opts.judgeModel
        ? (opts.judgeModel as string).split(',').map((m: string) => m.trim())
        : DEFAULT_JUDGE_MODELS;
      const judgeModels = judgeModelIds.map(id => createModel('openrouter', id, internalApiKey));
      const evalResults = await evaluateResults(skill, testResults, judgeModels, models, opts.verbose);

      // Compute and print report
      const reports = computeReport(evalResults, modelIds);
      console.log('');
      printReport(reports, evalResults, { json: opts.json, verbose: opts.verbose });

      // Exit code based on scores
      const allPassing = reports.every(r => r.overall >= 50);
      process.exit(allPassing ? 0 : 1);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();
