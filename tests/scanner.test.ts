import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scanForSkills } from '../src/scanner.js';

const TEST_DIR = join(import.meta.dirname, 'fixtures', 'scan-test');

beforeAll(async () => {
  // Create a nested folder structure with multiple SKILL.md files
  await mkdir(join(TEST_DIR, 'skills', 'commit-helper'), { recursive: true });
  await mkdir(join(TEST_DIR, 'skills', 'code-review'), { recursive: true });
  await mkdir(join(TEST_DIR, 'skills', 'empty-skill'), { recursive: true });
  await mkdir(join(TEST_DIR, 'nested', 'deep', 'skill-dir'), { recursive: true });
  await mkdir(join(TEST_DIR, 'node_modules', 'some-pkg'), { recursive: true });

  await writeFile(
    join(TEST_DIR, 'skills', 'commit-helper', 'SKILL.md'),
    '---\nname: commit-helper\ndescription: Helps write git commits\n---\n\n# Commit Helper\n\nUse git to create commits.',
  );

  await writeFile(
    join(TEST_DIR, 'skills', 'code-review', 'SKILL.md'),
    '---\nname: code-review\ndescription: Reviews code for quality\n---\n\n# Code Review\n\nReview the code for bugs.',
  );

  // A SKILL.md with no frontmatter (should still parse)
  await writeFile(
    join(TEST_DIR, 'nested', 'deep', 'skill-dir', 'SKILL.md'),
    '# Deep Skill\n\nA skill buried deep in nested folders.\n\nDo something useful.',
  );

  // A SKILL.md with no content body (should cause a parse error)
  await writeFile(
    join(TEST_DIR, 'skills', 'empty-skill', 'SKILL.md'),
    '---\nname: empty\ndescription: empty\n---\n',
  );

  // A SKILL.md inside node_modules (should be skipped)
  await writeFile(
    join(TEST_DIR, 'node_modules', 'some-pkg', 'SKILL.md'),
    '---\nname: ignored\ndescription: Should be ignored\n---\n\n# Ignored Skill\n\nThis is inside node_modules.',
  );
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('scanForSkills', () => {
  it('discovers all SKILL.md files recursively', async () => {
    const result = await scanForSkills(TEST_DIR);
    // Should find commit-helper, code-review, deep-skill (3 valid) + empty-skill (1 error)
    expect(result.paths.length).toBeGreaterThanOrEqual(3);
  });

  it('parses valid skills correctly', async () => {
    const result = await scanForSkills(TEST_DIR);
    const names = result.skills.map(s => s.name);
    expect(names).toContain('commit-helper');
    expect(names).toContain('code-review');
    expect(names).toContain('Deep Skill');
  });

  it('reports parse errors for invalid skills', async () => {
    const result = await scanForSkills(TEST_DIR);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.path.includes('empty-skill'))).toBe(true);
  });

  it('skips node_modules directories', async () => {
    const result = await scanForSkills(TEST_DIR);
    const names = result.skills.map(s => s.name);
    expect(names).not.toContain('ignored');

    const allPaths = [...result.paths, ...result.errors.map(e => e.path)];
    expect(allPaths.some(p => p.includes('node_modules'))).toBe(false);
  });

  it('throws for invalid source', async () => {
    await expect(scanForSkills('/nonexistent/path/that/does/not/exist'))
      .rejects.toThrow('not a valid folder path');
  });
});

describe('buildTriggerSystemPrompt with sibling skills', () => {
  it('uses sibling skills as distractors when provided', async () => {
    const { buildTriggerSystemPrompt } = await import('../src/context-builder.js');
    const result = await scanForSkills(TEST_DIR);
    const target = result.skills.find(s => s.name === 'commit-helper')!;
    const siblings = result.skills.filter(s => s.name !== 'commit-helper');

    const prompt = buildTriggerSystemPrompt(target, siblings);

    // Should contain target skill
    expect(prompt).toContain('<name>commit-helper</name>');

    // Should contain sibling skills as distractors
    for (const sibling of siblings) {
      expect(prompt).toContain(`<name>${sibling.name}</name>`);
    }

    // Should ALSO contain dummy skills alongside siblings
    expect(prompt).toContain('git-commit-helper');
    expect(prompt).toContain('api-documentation');
  });

  it('falls back to dummy skills when no siblings provided', async () => {
    const { buildTriggerSystemPrompt } = await import('../src/context-builder.js');
    const result = await scanForSkills(TEST_DIR);
    const target = result.skills[0];

    const prompt = buildTriggerSystemPrompt(target);

    expect(prompt).toContain('git-commit-helper');
    expect(prompt).toContain('api-documentation');
    expect(prompt).toContain('test-generator');
  });
});
