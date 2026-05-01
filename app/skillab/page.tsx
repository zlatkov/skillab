'use client';

import Link from 'next/link';
import { useState, useRef, useEffect, useCallback } from 'react';
import type {
  SkillDefinition,
  LogEntry,
  BatchSkillReport,
  EvalConfig,
  EvalReport,
  EvalResult,
  ProviderName,
  TestPrompt,
  SkillGraph,
} from '@/lib/types';
import {
  PROVIDER_NAMES,
  PROVIDER_MODELS,
  KNOWN_TOOLS,
  DEFAULT_PROVIDER,
  detectToolsInSkill,
  getDefaultModels,
} from '@/lib/types';
import { parseSkillContent, buildDependencyGraph, fetchSkillsFromGitHub } from '@/lib/skill';
import { runEvaluation } from '@/lib/engine';

type InputMode = 'github' | 'upload' | 'paste';
type ActionMode = 'evaluate' | 'graph';
type AppStatus = 'idle' | 'running' | 'complete' | 'error';

const EXAMPLE_SKILL = `---
name: ai-news
description: Fetches the latest AI news from multiple sources and summarizes them
---

# ai-news

Fetch and summarize the latest AI news.

## When to trigger

Use this skill when the user asks about recent AI news, AI developments, or wants a summary of what's happening in AI.

## Instructions

1. Use WebSearch to find recent AI news from sources like TechCrunch, The Verge, and ArsTechnica
2. Fetch the top 3-5 results using WebFetch
3. Summarize each article in 2-3 sentences
4. Present the summaries in a bulleted list with source links
`;

export default function Home() {
  // Skill input state
  const [inputMode, setInputMode] = useState<InputMode>('github');
  const [skillContent, setSkillContent] = useState('');
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [parseError, setParseError] = useState('');
  const [githubSource, setGithubSource] = useState('');
  const [actionMode, setActionMode] = useState<ActionMode>('evaluate');
  const [selectedSkillIndex, setSelectedSkillIndex] = useState<number>(0);
  const [graphBuilt, setGraphBuilt] = useState(false);
  const [isFetchingGithub, setIsFetchingGithub] = useState(false);
  const [githubStatus, setGithubStatus] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<ActionMode | null>(null);


  // Config state
  const [provider, setProvider] = useState<ProviderName>(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState('');
  const [providerHasKey, setProviderHasKey] = useState<Record<string, boolean>>({});
  const [selectedTestModels, setSelectedTestModels] = useState<string[]>(getDefaultModels(DEFAULT_PROVIDER).test);
  const [selectedGeneratorModels, setSelectedGeneratorModels] = useState<string[]>(getDefaultModels(DEFAULT_PROVIDER).generator);
  const [selectedJudgeModels, setSelectedJudgeModels] = useState<string[]>(getDefaultModels(DEFAULT_PROVIDER).judge);
  const [customModelInput, setCustomModelInput] = useState('');
  const [count, setCount] = useState(5);
  const [verbose, setVerbose] = useState(true);
  const [azureResourceName, setAzureResourceName] = useState('');

  // Tools
  const [enabledTools, setEnabledTools] = useState<string[]>([...KNOWN_TOOLS]);
  const [customToolInput, setCustomToolInput] = useState('');

  // Custom prompts
  const [customPromptsInput, setCustomPromptsInput] = useState('');

  // Whether the current provider is using a server key (no user BYOK)
  const usingServerKey = providerHasKey[provider] && !apiKey;

  // When provider changes, reset to that provider's defaults
  const handleProviderChange = (newProvider: ProviderName) => {
    setProvider(newProvider);
    const freeOnly = providerHasKey[newProvider] && !apiKey;
    const defaults = getDefaultModels(newProvider, freeOnly);
    setSelectedTestModels(defaults.test);
    setSelectedGeneratorModels(defaults.generator);
    setSelectedJudgeModels(defaults.judge);
  };

  // Run state
  const [status, setStatus] = useState<AppStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<BatchSkillReport[]>([]);
  const [graph, setGraph] = useState<SkillGraph | null>(null);

  // Refs
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const skipParseRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Fetch which providers have server-side API keys
  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(data => {
      setProviderHasKey(data.hasKey ?? {});
    }).catch(() => {});
  }, []);

  // Reset model selections when switching between server key and BYOK
  const prevUsingServerKeyRef = useRef(usingServerKey);
  useEffect(() => {
    if (prevUsingServerKeyRef.current !== usingServerKey) {
      prevUsingServerKeyRef.current = usingServerKey;
      const defaults = getDefaultModels(provider, usingServerKey);
      setSelectedTestModels(defaults.test);
      setSelectedGeneratorModels(defaults.generator);
      setSelectedJudgeModels(defaults.judge);
      // Clamp count when switching to server key
      if (usingServerKey) setCount(c => Math.min(c, 5));
    }
  }, [usingServerKey, provider]);

  // Auto-detect tools when selected skill changes
  useEffect(() => {
    if (skills.length > 0) {
      const skill = skills[selectedSkillIndex] || skills[0];
      const detected = detectToolsInSkill(skill.body);
      setEnabledTools(detected.length > 0 ? detected : [...KNOWN_TOOLS]);
    }
  }, [skills, selectedSkillIndex]);

  // Parse skill content whenever it changes
  const handleParseSkills = useCallback(() => {
    if (skipParseRef.current) {
      skipParseRef.current = false;
      return;
    }
    if (!skillContent.trim()) {
      setSkills([]);
      setParseError('');
      setGraph(null);
      return;
    }
    try {
      // Support multiple skills separated by a delimiter
      const sections = skillContent.includes('\n===SKILL===\n')
        ? skillContent.split('\n===SKILL===\n')
        : [skillContent];

      const parsed = sections
        .map((s, i) => parseSkillContent(s.trim(), `skill-${i + 1}`))
        .filter(s => s.body);

      setSkills(parsed);
      setParseError('');
      setGraph(null);
      setGraphBuilt(false);
    } catch (err) {
      setSkills([]);
      setParseError(err instanceof Error ? err.message : String(err));
      setGraph(null);
    }
  }, [skillContent]);

  useEffect(() => {
    handleParseSkills();
  }, [handleParseSkills]);

  // File upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const readers: Promise<string>[] = [];
    for (let i = 0; i < files.length; i++) {
      readers.push(files[i].text());
    }

    Promise.all(readers).then(contents => {
      if (contents.length === 1) {
        setSkillContent(contents[0]);
      } else {
        setSkillContent(contents.join('\n===SKILL===\n'));
      }
      setInputMode('paste');
    });
  };

  // Fetch skills from GitHub
  const handleFetchGithub = async () => {
    if (!githubSource.trim()) return;

    setIsFetchingGithub(true);
    setParseError('');
    setGithubStatus('');
    try {
      const fetched = await fetchSkillsFromGitHub(githubSource.trim(), (msg) => {
        setGithubStatus(msg);
      });
      if (fetched.length === 0) {
        setParseError('No SKILL.md files found');
      } else {
        setSkills(fetched);
        setGraph(null);
        // Populate the content area so user can switch to Paste/Edit
        // Skip re-parsing since we already have the parsed skills
        skipParseRef.current = true;
        setSkillContent(fetched.map(s => s.rawContent).join('\n===SKILL===\n'));
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingGithub(false);
    }
  };

  // Clear skills
  const handleClearAllSkills = () => {
    setSkills([]);
    setSkillContent('');
    setGraph(null);
    setGraphBuilt(false);
    setParseError('');
    setGithubStatus('');
    setSelectedSkillIndex(0);
  };

  const handleRemoveSkill = (index: number) => {
    const updated = skills.filter((_, i) => i !== index);
    setSkills(updated);
    setSkillContent(updated.map(s => s.rawContent).join('\n===SKILL===\n'));
    setGraph(null);
    setGraphBuilt(false);
    setSelectedSkillIndex(prev => prev >= updated.length ? 0 : prev);
  };

  // Build dependency graph
  const [graphProgress, setGraphProgress] = useState('');
  const [isBuildingGraph, setIsBuildingGraph] = useState(false);

  const handleBuildGraph = async () => {
    if (skills.length < 2) return;
    setIsBuildingGraph(true);
    setGraphProgress(`Analysing 0/${skills.length} skills...`);
    const result = await buildDependencyGraph(skills, (current, total) => {
      setGraphProgress(`Analysing ${current}/${total} skills...`);
    });
    setGraph(result);
    setGraphBuilt(true);
    setGraphProgress('');
    setIsBuildingGraph(false);
  };

  // Run evaluation
  const handleRun = async () => {
    if (skills.length === 0 || (!apiKey && !providerHasKey[provider])) return;

    // Abort any previous run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStatus('running');
    setLogs([]);
    setResults([]);

    if (selectedTestModels.length === 0) {
      setLogs([{ text: 'No test models selected. Pick at least one model to evaluate.', type: 'error', timestamp: Date.now() }]);
      setStatus('error');
      return;
    }
    if (selectedGeneratorModels.length === 0) {
      setLogs([{ text: 'No generator model selected. Pick one in Advanced Options.', type: 'error', timestamp: Date.now() }]);
      setStatus('error');
      return;
    }
    if (selectedJudgeModels.length === 0) {
      setLogs([{ text: 'No judge model selected. Pick one in Advanced Options.', type: 'error', timestamp: Date.now() }]);
      setStatus('error');
      return;
    }

    const config: EvalConfig = {
      provider,
      apiKey,
      modelIds: selectedTestModels,
      generatorModelIds: selectedGeneratorModels,
      judgeModelIds: selectedJudgeModels,
      count,
      verbose,
      azureResourceName: azureResourceName || undefined,
      enabledTools,
    };

    // Parse custom prompts if provided
    let customPrompts: TestPrompt[] | undefined;
    if (customPromptsInput.trim()) {
      try {
        customPrompts = JSON.parse(customPromptsInput);
      } catch {
        setLogs([{ text: 'Invalid custom prompts JSON', type: 'error', timestamp: Date.now() }]);
        setStatus('error');
        return;
      }
    }

    try {
      const skillToEval = skills[selectedSkillIndex] || skills[0];
      const evalResults = await runEvaluation(
        [skillToEval],
        config,
        (entry) => {
          if (!controller.signal.aborted) {
            setLogs(prev => [...prev, entry]);
          }
        },
        customPrompts,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResults(evalResults);
        setStatus('complete');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      if (!controller.signal.aborted) {
        setLogs(prev => [...prev, { text: `Fatal error: ${msg}`, type: 'error', timestamp: Date.now() }]);
        setStatus('error');
      }
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus('idle');
  };

  const switchTo = (mode: ActionMode) => {
    if (mode === 'evaluate') {
      setGraph(null); setGraphBuilt(false); setGraphProgress('');
    } else {
      setResults([]); setLogs([]); setStatus('idle');
    }
    setActionMode(mode);
  };

  const handleSwitchTool = (mode: ActionMode) => {
    if (mode === actionMode) return;
    if (status === 'running' || isBuildingGraph) {
      setPendingSwitch(mode);
    } else {
      switchTo(mode);
    }
  };

  const confirmSwitch = () => {
    if (!pendingSwitch) return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus('idle');
    setIsBuildingGraph(false);
    switchTo(pendingSwitch);
    setPendingSwitch(null);
  };

  const cancelSwitch = () => {
    setPendingSwitch(null);
  };

  // Scroll-spy: track which section is currently in view
  const [activeSection, setActiveSection] = useState('skill-input');
  const hashLockRef = useRef(false);

  useEffect(() => {
    const ids = ['skill-input', 'tool', 'results'];
    const visibleIds = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        if (hashLockRef.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleIds.add(entry.target.id);
          } else {
            visibleIds.delete(entry.target.id);
          }
        }
        for (const id of ids) {
          if (visibleIds.has(id)) {
            setActiveSection(id);
            break;
          }
        }
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    const onHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash && ids.includes(hash)) {
        setActiveSection(hash);
        hashLockRef.current = true;
        setTimeout(() => { hashLockRef.current = false; }, 1000);
      }
    };
    window.addEventListener('hashchange', onHash);
    onHash();

    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', onHash);
    };
  }, [graph, results, logs, actionMode]);

  const hasResults = (actionMode === 'graph' && graph) || (actionMode === 'evaluate' && (results.length > 0 || logs.length > 0));

  const navItems = [
    { id: 'skill-input', label: 'Skill Input', badge: skills.length > 0 ? `(${skills.length})` : undefined },
    { id: 'tool', label: 'Tool' },
    ...(hasResults ? [{ id: 'results', label: 'Results' }] : []),
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex gap-8">
      {/* Left sidebar nav */}
      <nav className="hidden md:block w-36 shrink-0">
        <div className="sticky top-8">
          <Link href="/" className="text-xs text-text-dim hover:text-accent transition-colors">&larr; Home</Link>
          <div className="mt-3 mb-4">
            <span className="text-lg font-bold text-accent">skillab</span>
            <span className="text-text-dim text-xs ml-1.5">v0.3.0</span>
          </div>
          <ul className="space-y-2 text-xs">
            {navItems.map(item => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`transition-colors ${
                    activeSection === item.id
                      ? 'text-accent font-bold'
                      : 'text-text-dim hover:text-accent'
                  }`}
                >
                  {item.label}
                  {item.badge && <span className="ml-1 text-success">{item.badge}</span>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0">
      {/* Mobile header */}
      <header className="mb-8 md:hidden">
        <Link href="/" className="text-xs text-text-dim hover:text-accent transition-colors">&larr; Home</Link>
        <div className="flex items-baseline gap-3 mt-2">
          <h1 className="text-2xl font-bold text-accent">skillab</h1>
          <span className="text-text-dim text-sm">v0.3.0</span>
        </div>
        <p className="text-text-dim text-sm mt-1">
          Tools for working with Agent Skills (SKILL.md files)
        </p>
      </header>

      {/* Skill Input Section */}
      <section id="skill-input" className="mb-6 border border-border rounded-lg p-4 bg-bg-secondary scroll-mt-8">
        <h2 className="text-sm font-bold text-text-dim uppercase tracking-wider mb-1">Skill Input</h2>
        <p className="text-xs text-text-dim mb-3">
          Load one or more SKILL.md files — from a GitHub repo, a folder of skills, or paste directly
        </p>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {(['github', 'upload', 'paste'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setInputMode(mode)}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                inputMode === mode
                  ? 'bg-accent-dim text-white'
                  : 'bg-bg-tertiary text-text-dim hover:text-text'
              }`}
            >
              {{ github: 'GitHub', upload: 'Upload', paste: 'Paste / Edit' }[mode]}
            </button>
          ))}
        </div>

        {inputMode === 'github' && (
          <div>
            <input
              value={githubSource}
              onChange={e => setGithubSource(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleFetchGithub(); }}
              placeholder="owner/repo, https://github.com/owner/repo, or .../tree/main/skills"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm font-mono"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handleFetchGithub}
                disabled={!githubSource.trim() || isFetchingGithub}
                className="px-4 py-2 bg-accent-dim text-white rounded text-sm hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isFetchingGithub ? <span className="loading-text">Fetching...</span> : 'Fetch Skills'}
              </button>
              {githubStatus && (
                <span className={`text-xs text-text-dim ${isFetchingGithub ? 'loading-text' : ''}`}>{githubStatus}</span>
              )}
            </div>
            <p className="text-xs text-text-dim mt-2">
              Supports: <code className="text-text">owner/repo</code> &middot; <code className="text-text">https://github.com/owner/repo</code> &middot; <code className="text-text">.../tree/main/skills</code> &middot; <code className="text-text">.../blob/main/SKILL.md</code>
            </p>
            {!skills.length && !isFetchingGithub && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-text-dim mb-2">
                  Top repos on <a href="https://skills.sh" target="_blank" rel="noopener" className="text-accent hover:underline">skills.sh</a>:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'Vercel Labs', repo: 'vercel-labs/agent-skills' },
                    { label: 'Anthropic', repo: 'anthropics/skills' },
                    { label: 'Microsoft', repo: 'microsoft/azure-skills' },
                    { label: 'Remotion', repo: 'remotion-dev/skills' },
                    { label: 'Soultrace', repo: 'soultrace-ai/soultrace-skill' },
                  ].map(({ label, repo }) => (
                    <button
                      key={repo}
                      onClick={() => setGithubSource(repo)}
                      className="px-2.5 py-1 text-xs rounded border border-border bg-bg-tertiary text-text-dim hover:border-accent/50 hover:text-accent transition-colors cursor-pointer"
                    >
                      {label} <span className="opacity-50">({repo})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {inputMode === 'upload' && (
          <div className="border border-dashed border-border rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".md"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <p className="text-text-dim mb-2">Drop SKILL.md files or click to browse</p>
              <p className="text-xs text-text-dim">Supports multiple files for batch evaluation</p>
            </label>
          </div>
        )}

        {inputMode === 'paste' && (
          <div>
            <textarea
              value={skillContent}
              onChange={e => setSkillContent(e.target.value)}
              placeholder="Paste your SKILL.md content here..."
              className="w-full h-64 bg-bg-tertiary border border-border rounded-lg p-3 text-sm font-mono resize-y placeholder:text-text-dim/50"
            />
            {!skillContent && (
              <button
                onClick={() => setSkillContent(EXAMPLE_SKILL)}
                className="mt-2 text-xs text-accent-dim hover:text-accent transition-colors"
              >
                Load example skill
              </button>
            )}
          </div>
        )}

        {/* Parsed skill info */}
        {skills.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-success">
                {skills.length} skill{skills.length > 1 ? 's' : ''} loaded
              </p>
              <button
                onClick={handleClearAllSkills}
                className="text-xs text-text-dim hover:text-error transition-colors cursor-pointer"
              >
                Clear all
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto">
            {skills.map((skill, i) => (
              <div key={i} className="flex items-center gap-2 text-sm mb-1 group rounded px-2 py-1 -mx-2 hover:bg-bg-tertiary transition-colors">
                <span className="text-success">&#10003;</span>
                <span className="font-bold">{skill.name}</span>
                {skill.description && skill.description !== 'No description available' && (
                  <span className="text-text-dim">&#8212; {truncateAtSentence(skill.description, 120)}</span>
                )}
                <button
                  onClick={() => handleRemoveSkill(i)}
                  className="ml-auto text-text-dim/0 group-hover:text-text-dim hover:!text-error transition-colors text-xs cursor-pointer px-1"
                  title={`Remove ${skill.name}`}
                >
                  &#10005;
                </button>
              </div>
            ))}
            </div>
          </div>
        )}
        {parseError && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-sm text-error">&#10007; {parseError}</p>
          </div>
        )}
      </section>

      {/* Action Mode */}
      <section id="tool" className="mb-6 border border-border rounded-lg p-4 bg-bg-secondary scroll-mt-8">
        <h2 className="text-sm font-bold text-text-dim uppercase tracking-wider mb-3">Tool</h2>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => handleSwitchTool('evaluate')}
            className={`px-4 py-2 text-sm rounded border transition-colors ${
              actionMode === 'evaluate'
                ? 'bg-accent/20 border-accent/50 text-accent'
                : 'bg-bg-tertiary border-border text-text-dim hover:text-text hover:border-border-hover'
            }`}
          >
            Skill Evaluator
          </button>
          <button
            onClick={() => handleSwitchTool('graph')}
            className={`px-4 py-2 text-sm rounded border transition-colors ${
              actionMode === 'graph'
                ? 'bg-accent/20 border-accent/50 text-accent'
                : 'bg-bg-tertiary border-border text-text-dim hover:text-text hover:border-border-hover'
            }`}
          >
            Dependency Graph
          </button>
        </div>
        <p className="text-xs text-text-dim">
          {actionMode === 'evaluate'
            ? 'Test how well models trigger and follow the skill instructions'
            : 'Visualise how skills reference each other (no API key needed, requires 2+ skills)'}
        </p>

        {actionMode === 'graph' && (
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleBuildGraph}
              disabled={skills.length < 2 || isBuildingGraph}
              className={`px-6 py-2.5 font-bold rounded text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                graphBuilt
                  ? 'bg-success text-black'
                  : 'bg-accent text-black hover:bg-accent/90'
              }`}
            >
              {isBuildingGraph ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span className="loading-text">{graphProgress}</span>
                </span>
              ) : graphBuilt ? '✓ Graph Built' : 'Build Graph'}
            </button>
          </div>
        )}

        {actionMode === 'evaluate' && (
          <>
            {skills.length > 1 && (
              <div className="mb-4">
                <label className="block text-xs text-text-dim mb-1">Skill to evaluate</label>
                <select
                  value={selectedSkillIndex}
                  onChange={e => setSelectedSkillIndex(parseInt(e.target.value))}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm"
                >
                  {skills.map((skill, i) => (
                    <option key={i} value={i}>{skill.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-dim mb-1">Provider</label>
                <select
                  value={provider}
                  onChange={e => handleProviderChange(e.target.value as ProviderName)}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm"
                >
                  {PROVIDER_NAMES.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-text-dim mb-1">
                  API Key
                  {providerHasKey[provider] && !apiKey && (
                    <span className="ml-2 text-success font-normal">Server key available</span>
                  )}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={providerHasKey[provider] ? `Using server key — or enter your own` : `Enter your ${provider} API key`}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm"
                />
                <p className="text-xs text-text-dim mt-1">
                  {providerHasKey[provider]
                    ? 'A server key is configured. Enter your own to override it.'
                    : 'Keys are sent directly to the provider, never stored'}
                </p>
              </div>

              {provider === 'azure' && (
                <div className="md:col-span-2">
                  <label className="block text-xs text-text-dim mb-1">Azure Resource Name</label>
                  <input
                    value={azureResourceName}
                    onChange={e => setAzureResourceName(e.target.value)}
                    placeholder="your-resource-name"
                    className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>

            {usingServerKey && (
              <div className="mt-4 px-3 py-2 rounded border border-accent/30 bg-accent/5 text-xs text-accent">
                Using server key — free models only, 1 test model, max 5 prompts per type. Enter your own API key to remove limits.
              </div>
            )}

            {/* Test Models */}
            <div className="mt-4">
              <ModelPicker
                label="Test Models"
                description={usingServerKey
                  ? "One model at a time when using server key. Enter your own key for multi-model."
                  : "Each selected model will be evaluated independently against the skill"}
                options={PROVIDER_MODELS[provider].test}
                selected={selectedTestModels}
                onChange={setSelectedTestModels}
                provider={provider}
                defaultIds={getDefaultModels(provider, usingServerKey).test}
                freeOnly={usingServerKey}
                singleSelect={usingServerKey}
              />
            </div>

            {/* Advanced options */}
            <details className="mt-4 border border-border rounded-lg overflow-hidden">
              <summary className="text-sm cursor-pointer hover:text-text px-3 py-2 bg-bg-tertiary">
                <span className="font-bold text-text-dim">Advanced Options</span>
                <span className="text-xs text-text-dim/60 ml-2">
                  — {count}+{count} prompts
                  {' | '}Generator: {selectedGeneratorModels.length > 0
                    ? (() => { const opt = PROVIDER_MODELS[provider].generator.find(o => o.id === selectedGeneratorModels[0]); return opt ? opt.label : selectedGeneratorModels[0]; })()
                    : 'none'}
                  {' | '}Judge: {selectedJudgeModels.length > 0
                    ? (() => { const opt = PROVIDER_MODELS[provider].judge.find(o => o.id === selectedJudgeModels[0]); return opt ? opt.label : selectedJudgeModels[0]; })()
                    : 'none'}
                  {' | '}Tools: {enabledTools.length}
                </span>
              </summary>
              <div className="p-3 space-y-4">
                <div className="flex items-center gap-6 flex-wrap">
                  <div>
                    <label className="block text-xs text-text-dim mb-1">
                      Prompts per type <span className="text-text-dim/60">(positive = should trigger, negative = should not)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={usingServerKey ? 5 : 20}
                        value={count}
                        onChange={e => {
                          const max = usingServerKey ? 5 : 20;
                          setCount(Math.min(parseInt(e.target.value) || 5, max));
                        }}
                        className="w-20 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm"
                      />
                      <span className="text-xs text-text-dim">
                        {count} + {count} = {count * 2} total
                        {usingServerKey && ' (max 5 with server key)'}
                      </span>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={verbose}
                      onChange={e => setVerbose(e.target.checked)}
                      className="accent-accent"
                    />
                    Verbose output
                  </label>
                </div>
                <ModelPicker
                  label="Generator Model"
                  description="Generates test prompts from the skill definition"
                  options={PROVIDER_MODELS[provider].generator}
                  selected={selectedGeneratorModels}
                  onChange={setSelectedGeneratorModels}
                  provider={provider}
                  defaultIds={getDefaultModels(provider, usingServerKey).generator}
                  singleSelect
                  freeOnly={usingServerKey}
                />
                <ModelPicker
                  label="Judge Model"
                  description="Evaluates trigger accuracy and instruction compliance"
                  options={PROVIDER_MODELS[provider].judge}
                  selected={selectedJudgeModels}
                  onChange={setSelectedJudgeModels}
                  provider={provider}
                  defaultIds={getDefaultModels(provider, usingServerKey).judge}
                  singleSelect
                  freeOnly={usingServerKey}
                />
                {/* Mock Tools */}
                <div>
                  <label className="block text-xs text-text-dim mb-1">Available Tools</label>
                  <p className="text-xs text-text-dim/60 mb-2">
                    Tools provided to the model during compliance testing. Auto-detected from the skill content. The model can make structured tool calls against these (with mock responses).
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {KNOWN_TOOLS.map(tool => (
                      <button
                        key={tool}
                        onClick={() =>
                          setEnabledTools(prev =>
                            prev.includes(tool)
                              ? prev.filter(t => t !== tool)
                              : [...prev, tool],
                          )
                        }
                        className={`px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${
                          enabledTools.includes(tool)
                            ? 'bg-accent/20 border-accent/50 text-accent'
                            : 'bg-bg-tertiary border-border text-text-dim hover:border-accent/30 hover:text-text'
                        }`}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                  {/* Custom tools already added */}
                  {enabledTools.filter(t => !KNOWN_TOOLS.includes(t as typeof KNOWN_TOOLS[number])).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {enabledTools.filter(t => !KNOWN_TOOLS.includes(t as typeof KNOWN_TOOLS[number])).map(tool => (
                        <button
                          key={tool}
                          onClick={() => setEnabledTools(prev => prev.filter(t => t !== tool))}
                          className="px-2.5 py-1 text-xs rounded border bg-accent/20 border-accent/50 text-accent cursor-pointer"
                        >
                          {tool} <span className="opacity-60">&times;</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 mb-2">
                    <input
                      value={customToolInput}
                      onChange={e => setCustomToolInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const name = customToolInput.trim();
                          if (name && !enabledTools.includes(name)) {
                            setEnabledTools(prev => [...prev, name]);
                          }
                          setCustomToolInput('');
                        }
                      }}
                      placeholder="Add custom tool name..."
                      className="flex-1 bg-bg-tertiary border border-border rounded px-2.5 py-1 text-xs font-mono"
                    />
                    <button
                      onClick={() => {
                        const name = customToolInput.trim();
                        if (name && !enabledTools.includes(name)) {
                          setEnabledTools(prev => [...prev, name]);
                        }
                        setCustomToolInput('');
                      }}
                      disabled={!customToolInput.trim()}
                      className="px-3 py-1 text-xs bg-bg-tertiary border border-border rounded hover:border-border-hover transition-colors disabled:opacity-30"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button
                      onClick={() => setEnabledTools([...KNOWN_TOOLS])}
                      className="text-text-dim hover:text-accent transition-colors cursor-pointer"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setEnabledTools([])}
                      className="text-text-dim hover:text-accent transition-colors cursor-pointer"
                    >
                      Clear all
                    </button>
                    <button
                      onClick={() => {
                        if (skills.length > 0) {
                          const skill = skills[selectedSkillIndex] || skills[0];
                          setEnabledTools(detectToolsInSkill(skill.body));
                        }
                      }}
                      disabled={skills.length === 0}
                      className="text-text-dim hover:text-accent transition-colors cursor-pointer disabled:opacity-30"
                    >
                      Auto-detect
                    </button>
                  </div>
                  {enabledTools.length > 0 && (
                    <p className="text-xs text-text-dim/50 mt-1.5">
                      {enabledTools.length} tool{enabledTools.length !== 1 ? 's' : ''} enabled
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-text-dim mb-1">
                    Custom Test Prompts
                  </label>
                  <p className="text-xs text-text-dim/60 mb-2">
                    Optional — override auto-generated prompts with your own. Leave empty to let the generator model create them.
                  </p>
                  <textarea
                    value={customPromptsInput}
                    onChange={e => setCustomPromptsInput(e.target.value)}
                    placeholder={'[{"text": "Help me extract text from this PDF", "type": "positive"}, ...]'}
                    className="w-full h-24 bg-bg-tertiary border border-border rounded p-3 text-sm font-mono resize-y placeholder:text-text-dim/50"
                  />
                </div>
              </div>
            </details>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleRun}
              disabled={skills.length === 0 || (!apiKey && !providerHasKey[provider]) || status === 'running'}
              className="px-6 py-2.5 bg-accent text-black font-bold rounded text-sm hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'running' ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span className="loading-text">Running...</span>
                </span>
              ) : (
                'Run Evaluation'
              )}
            </button>
            {status === 'running' && (
              <button
                onClick={handleStop}
                className="px-4 py-2.5 bg-error/20 text-error border border-error/30 rounded text-sm hover:bg-error/30 transition-colors"
              >
                Stop
              </button>
            )}
          </div>
          </>
        )}
      </section>

      {/* Dependency Graph */}
      {actionMode === 'graph' && graph && (
        <section id="results" className="mb-6 border border-border rounded-lg p-4 bg-bg-secondary scroll-mt-8">
          <h2 className="text-sm font-bold text-text-dim uppercase tracking-wider mb-3">Dependency Graph</h2>
          <GraphView graph={graph} />
        </section>
      )}

      {/* Progress Log */}
      {actionMode === 'evaluate' && logs.length > 0 && (
        <section id="results" className="mb-6 border border-border rounded-lg bg-bg-secondary overflow-hidden scroll-mt-8">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-text-dim uppercase tracking-wider">Output</h2>
            <span className="text-xs text-text-dim">{logs.length} entries</span>
          </div>
          <div className="p-4 max-h-80 overflow-y-auto font-mono text-xs leading-relaxed">
            {logs.map((entry, i) => (
              <LogLine key={i} entry={entry} />
            ))}
            <div ref={logsEndRef} />
          </div>
        </section>
      )}

      {/* Results */}
      {actionMode === 'evaluate' && results.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-bold text-text-dim uppercase tracking-wider mb-3">Results</h2>
          {results.map((batch, i) => (
            <div key={i} className="mb-6">
              {results.length > 1 && (
                <h3 className="text-accent font-bold mb-2">
                  &#9472;&#9472;&#9472; Skill: {batch.skill.name} &#9472;&#9472;&#9472;
                </h3>
              )}
              <p className="text-sm font-bold mb-2">{batch.skill.name}</p>
              <ResultsTable reports={batch.reports} />
              {verbose && <VerboseResults evalResults={batch.evalResults} />}
            </div>
          ))}

          {results.length > 1 && <BatchSummary results={results} />}

          {/* JSON export */}
          <details className="mt-4">
            <summary className="text-xs text-text-dim cursor-pointer hover:text-text">
              Export as JSON
            </summary>
            <pre className="mt-2 p-4 bg-bg-tertiary border border-border rounded-lg text-xs overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(results.map(r => ({
                skill: { name: r.skill.name, description: r.skill.description },
                reports: r.reports,
                evalResults: r.evalResults,
              })), null, 2)}
            </pre>
          </details>
        </section>
      )}

      {/* Switch tool confirmation modal */}
      {pendingSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-bg-secondary border border-border rounded-lg p-6 max-w-sm mx-4 shadow-lg">
            <p className="text-sm mb-4">
              A task is still running. Switch to <span className="font-bold text-accent">
                {pendingSwitch === 'evaluate' ? 'Skill Evaluator' : 'Dependency Graph'}
              </span> and stop the current run?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelSwitch}
                className="px-4 py-2 text-sm rounded border border-border bg-bg-tertiary text-text-dim hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmSwitch}
                className="px-4 py-2 text-sm rounded bg-accent text-black font-bold hover:bg-accent/90 transition-colors"
              >
                Switch &amp; Stop
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function ModelPicker({
  label,
  description,
  options,
  selected,
  onChange,
  provider,
  defaultIds,
  singleSelect = false,
  freeOnly = false,
}: {
  label: string;
  description: string;
  options: Array<{ id: string; label: string; free?: boolean }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  provider: ProviderName;
  defaultIds?: string[];
  singleSelect?: boolean;
  freeOnly?: boolean;
}) {
  const [customInput, setCustomInput] = useState('');

  const visibleOptions = freeOnly ? options.filter(o => o.free) : options;
  const hiddenCount = options.length - visibleOptions.length;

  const toggle = (id: string) => {
    if (singleSelect) {
      onChange(selected.includes(id) ? [] : [id]);
    } else {
      onChange(
        selected.includes(id)
          ? selected.filter(m => m !== id)
          : [...selected, id],
      );
    }
  };

  const addCustom = () => {
    const id = customInput.trim();
    if (!id) return;
    if (singleSelect) {
      onChange([id]);
    } else if (!selected.includes(id)) {
      onChange([...selected, id]);
    }
    setCustomInput('');
  };

  // Models in selected that aren't in the preset options
  const customModels = selected.filter(id => !options.some(o => o.id === id));

  return (
    <div>
      <label className="block text-xs text-text-dim mb-1">{label}</label>
      <p className="text-xs text-text-dim/70 mb-2">{description}</p>

      {visibleOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {visibleOptions.map((opt, i) => {
            const isSelected = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => toggle(opt.id)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-accent/20 border-accent/50 text-accent'
                    : 'bg-bg-tertiary border-border text-text-dim hover:border-accent/30 hover:text-text'
                }`}
                title={opt.id}
              >
                {opt.label}
              </button>
            );
          })}
          {freeOnly && hiddenCount > 0 && (
            <span className="px-2.5 py-1 text-xs text-text-dim/50 italic">
              +{hiddenCount} more with your own key
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-dim/50 mb-2 italic">
          {freeOnly ? 'No free models available — enter your own API key to unlock models' : `No presets for ${provider} — add model IDs manually below`}
        </p>
      )}

      {/* Custom models already added */}
      {customModels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {customModels.map(id => (
            <button
              key={id}
              onClick={() => toggle(id)}
              className="px-2.5 py-1 text-xs rounded border bg-accent/20 border-accent/50 text-accent cursor-pointer"
              title={id}
            >
              {id}
              <span className="ml-1 opacity-60">&times;</span>
            </button>
          ))}
        </div>
      )}

      {/* Add custom model — hidden when using server key (freeOnly) */}
      {!freeOnly && (
        <div className="flex gap-2">
          <input
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            placeholder={singleSelect ? 'Or enter a model ID...' : 'Add custom model ID...'}
            className="flex-1 bg-bg-tertiary border border-border rounded px-2.5 py-1 text-xs font-mono"
          />
          <button
            onClick={addCustom}
            disabled={!customInput.trim()}
            className="px-3 py-1 text-xs bg-bg-tertiary border border-border rounded hover:border-border-hover transition-colors disabled:opacity-30"
          >
            {singleSelect ? 'Use' : 'Add'}
          </button>
        </div>
      )}

      {selected.length > 0 && (
        <p className="text-xs text-text-dim/50 mt-1.5">
          {singleSelect ? '' : `${selected.length} selected: `}{selected.map(id => {
            const opt = options.find(o => o.id === id);
            return opt ? opt.label : id;
          }).join(', ')}
        </p>
      )}
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const colorClass = {
    info: 'text-text-dim',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
    progress: 'text-accent',
  }[entry.type];

  const prefix = {
    info: '  ',
    success: '+ ',
    warning: '! ',
    error: 'x ',
    progress: '> ',
  }[entry.type];

  return (
    <div className={`${colorClass} whitespace-pre-wrap`}>
      <span className="opacity-60">{prefix}</span>
      {entry.text}
    </div>
  );
}

function ResultsTable({ reports }: { reports: EvalReport[] }) {
  if (reports.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-bg-tertiary text-text-dim">
            <th className="text-left px-4 py-2 border-b border-border">Model</th>
            <th className="text-left px-4 py-2 border-b border-border">Trigger</th>
            <th className="text-left px-4 py-2 border-b border-border">Compliance</th>
            <th className="text-left px-4 py-2 border-b border-border">Overall</th>
          </tr>
        </thead>
        <tbody>
          {reports.map(report => (
            <tr key={report.modelId} className="border-b border-border last:border-b-0">
              <td className="px-4 py-2 font-mono text-xs">{report.modelId}</td>
              <td className="px-4 py-2">{report.triggerScore.correct}/{report.triggerScore.total}</td>
              <td className="px-4 py-2">
                {report.complianceScore.total > 0
                  ? `${report.complianceScore.correct}/${report.complianceScore.total} (${report.complianceScore.avgScore})`
                  : 'N/A'}
              </td>
              <td className={`px-4 py-2 font-bold ${scoreColor(report.overall)}`}>
                {report.overall}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {reports.length > 1 && (
        <div className="mt-2 text-sm">
          <span className="text-success">Best: </span>
          <span>{reports[0].modelId} ({reports[0].overall}%)</span>
          <span className="text-text-dim mx-2">|</span>
          <span className="text-error">Worst: </span>
          <span>{reports[reports.length - 1].modelId} ({reports[reports.length - 1].overall}%)</span>
        </div>
      )}
    </div>
  );
}

function VerboseResults({ evalResults }: { evalResults: EvalResult[] }) {
  const byModel = new Map<string, EvalResult[]>();
  for (const result of evalResults) {
    const arr = byModel.get(result.modelId) ?? [];
    arr.push(result);
    byModel.set(result.modelId, arr);
  }

  return (
    <div className="mt-4">
      {Array.from(byModel.entries()).map(([modelId, results]) => (
        <details key={modelId} className="mb-2">
          <summary className="text-sm font-bold cursor-pointer hover:text-accent">
            {modelId}
          </summary>
          <div className="ml-4 mt-1 text-xs space-y-1">
            {results.map((result, i) => (
              <div key={i}>
                <span className={result.trigger.correct ? 'text-success' : 'text-error'}>
                  [{result.trigger.correct ? 'PASS' : 'FAIL'}]
                </span>
                <span className="text-text-dim"> {result.prompt.type}: </span>
                <span>"{result.prompt.text.slice(0, 60)}"</span>
                <span className="text-text-dim"> &#8212; {result.trigger.reason}</span>
                {result.compliance && (
                  <div className="ml-6">
                    <span className={result.compliance.compliant ? 'text-success' : 'text-error'}>
                      Compliance: [{result.compliance.compliant ? 'PASS' : 'FAIL'}]
                    </span>
                    <span className="text-text-dim"> {result.compliance.score}/100 &#8212; {result.compliance.reason}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function BatchSummary({ results }: { results: BatchSkillReport[] }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-secondary mt-4">
      <h3 className="text-sm font-bold text-text-dim uppercase tracking-wider mb-3">Batch Summary</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-bg-tertiary text-text-dim">
              <th className="text-left px-4 py-2 border-b border-border">Skill</th>
              <th className="text-left px-4 py-2 border-b border-border">Model</th>
              <th className="text-left px-4 py-2 border-b border-border">Trigger</th>
              <th className="text-left px-4 py-2 border-b border-border">Compliance</th>
              <th className="text-left px-4 py-2 border-b border-border">Overall</th>
            </tr>
          </thead>
          <tbody>
            {results.map((batch, bi) =>
              batch.reports.map((report, ri) => (
                <tr key={`${bi}-${ri}`} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2">{ri === 0 ? batch.skill.name : ''}</td>
                  <td className="px-4 py-2 font-mono text-xs">{report.modelId}</td>
                  <td className="px-4 py-2">{report.triggerScore.correct}/{report.triggerScore.total}</td>
                  <td className="px-4 py-2">
                    {report.complianceScore.total > 0
                      ? `${report.complianceScore.correct}/${report.complianceScore.total} (${report.complianceScore.avgScore})`
                      : 'N/A'}
                  </td>
                  <td className={`px-4 py-2 font-bold ${scoreColor(report.overall)}`}>
                    {report.overall}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-sm">
        <p className="font-bold text-text-dim mb-1">Average scores per skill:</p>
        {results.map((batch, i) => {
          const avg = batch.reports.length > 0
            ? Math.round(batch.reports.reduce((sum, r) => sum + r.overall, 0) / batch.reports.length)
            : 0;
          return (
            <div key={i}>
              <span>{batch.skill.name}: </span>
              <span className={scoreColor(avg)}>{avg}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GraphView({ graph }: { graph: SkillGraph }) {
  const { nodes, edges } = graph;

  const outgoing = new Map<string, typeof edges>();
  const incoming = new Map<string, typeof edges>();
  for (const node of nodes) {
    outgoing.set(node, []);
    incoming.set(node, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)!.push(edge);
    incoming.get(edge.to)!.push(edge);
  }

  // Only show nodes involved in dependencies in the tree view
  const connectedNodes = nodes.filter(n => outgoing.get(n)!.length > 0 || incoming.get(n)!.length > 0);
  const isolatedCount = nodes.length - connectedNodes.length;

  // Build adjacency lookup for matrix — only for connected nodes
  const edgeLookup = new Map<string, string[]>();
  for (const edge of edges) {
    edgeLookup.set(`${edge.from}→${edge.to}`, edge.mentions);
  }

  // Summary
  const summary = `${nodes.length} skills, ${edges.length} dependencies${isolatedCount > 0 ? `, ${isolatedCount} isolated` : ''}`;

  if (edges.length === 0) {
    return (
      <div className="text-sm">
        <p className="text-text-dim">{summary}</p>
        <p className="text-text-dim mt-1">No cross-references found between the loaded skills.</p>
      </div>
    );
  }

  // For matrix, only show connected nodes (avoids huge empty matrices)
  const matrixNodes = connectedNodes.length > 0 ? connectedNodes : nodes;
  const showMatrix = matrixNodes.length <= 30;

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim">{summary}</p>

      {/* Tree view — only connected nodes */}
      <div className="font-mono text-sm space-y-1 max-h-64 overflow-y-auto">
        {connectedNodes.map(node => {
          const deps = outgoing.get(node)!;
          const depBy = incoming.get(node)!;
          let badge = '';
          if (depBy.length > 0 && deps.length === 0) {
            badge = ` (depended on by ${depBy.length})`;
          }

          return (
            <div key={node}>
              <div>
                <span className="text-accent">&#9679;</span>{' '}
                <span className="font-bold">{node}</span>
                <span className="text-text-dim">{badge}</span>
              </div>
              {deps.map((edge, i) => (
                <div key={i} className="ml-4 text-text-dim">
                  {i === deps.length - 1 ? '\u2514' : '\u251C'}&#9472;&#9472;&#9654; {edge.to}{' '}
                  <span className="opacity-60">({edge.mentions.join(', ')})</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Adjacency Matrix — only for connected nodes, capped at 30 */}
      {showMatrix ? (
        <div>
          <h3 className="text-xs font-bold text-text-dim uppercase tracking-wider mb-2">Adjacency Matrix</h3>
          <div className="overflow-x-auto">
            <table className="text-xs font-mono border-collapse">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-text-dim border border-border bg-bg-tertiary">
                    from ↓ / to →
                  </th>
                  {matrixNodes.map(col => (
                    <th key={col} className="px-2 py-1 text-center border border-border bg-bg-tertiary text-text-dim" title={col}>
                      {col.length > 12 ? col.slice(0, 11) + '…' : col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixNodes.map(row => (
                  <tr key={row}>
                    <td className="px-2 py-1 border border-border bg-bg-tertiary font-bold whitespace-nowrap">
                      {row}
                    </td>
                    {matrixNodes.map(col => {
                      const mentions = edgeLookup.get(`${row}→${col}`);
                      const isSelf = row === col;
                      return (
                        <td
                          key={col}
                          className={`px-2 py-1 text-center border border-border transition-colors ${
                            isSelf
                              ? 'bg-bg-tertiary text-text-dim/30'
                              : mentions
                                ? 'bg-accent/15 text-accent hover:bg-accent/30 cursor-help'
                                : 'text-text-dim/20 hover:bg-bg-tertiary'
                          }`}
                          title={mentions ? `${row} → ${col}: ${mentions.join(', ')}` : `${row} → ${col}: no dependency`}
                        >
                          {isSelf ? '·' : mentions ? '●' : '·'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-dim mt-2">
            <span className="text-accent">●</span> = dependency found — hover cells for details
          </p>
        </div>
      ) : (
        <p className="text-xs text-text-dim">
          Adjacency matrix hidden ({matrixNodes.length} connected skills — too large to render). Use the tree view above.
        </p>
      )}
    </div>
  );
}

function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastExcl = truncated.lastIndexOf('!');
  const lastQ = truncated.lastIndexOf('?');
  const lastBreak = Math.max(lastPeriod, lastExcl, lastQ);
  if (lastBreak > maxLen * 0.4) return truncated.slice(0, lastBreak + 1);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-success';
  if (score >= 40) return 'text-warning';
  return 'text-error';
}
