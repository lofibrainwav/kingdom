const fsp = require('fs').promises;
const path = require('path');
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { writePattern, addDashboardLink } = require('./vault-sync');

const log = getLogger();
const DEFAULT_VAULT_DIR = path.join(__dirname, '..', 'vault', '05-Operations');

class KnowledgeOperator {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.zk = options.zettelkasten || null;
    this.vaultDir = options.vaultDir || DEFAULT_VAULT_DIR;
    this.writePattern = options.writePattern || writePattern;
    this.addDashboardLink = options.addDashboardLink || addDashboardLink;
    this.logger = options.logger || null;
    this.subscriber = null;
  }

  async init() {
    if (this.board.connect && this.board.client && !this.board.client.isOpen) {
      await this.board.connect();
    }

    await fsp.mkdir(this.vaultDir, { recursive: true });
    log.info('knowledge-operator', `initialized, vault: ${this.vaultDir}`);
  }

  async start() {
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('knowledge-operator', 'Redis sub error', { error: err.message }));

    await this.subscriber.subscribe('governance:task:completed', async (message) => {
      await this.handleTaskCompleted(message);
    });

    await this.subscriber.subscribe('governance:review:approved', async (message) => {
      await this.handleReviewApproved(message);
    });

    await this.subscriber.subscribe('governance:failure:retry-requested', async (message) => {
      await this.handleRetryRequested(message);
    });

    await this.subscriber.subscribe('knowledge:skill:eval-completed', async (message) => {
      await this.handleSkillEvalCompleted(message);
    });
  }

  async shutdown() {
    if (this.subscriber && this.subscriber.disconnect) {
      await this.subscriber.disconnect();
    }

    if (this.board && this.board.disconnect && this.board.client && this.board.client.isOpen) {
      await this.board.disconnect();
    }
  }

  async capture(bundle) {
    this._validateBundle(bundle);
    const capturedAt = new Date().toISOString();
    const enrichedBundle = { ...bundle, capturedAt };

    const fileName = this._buildFileName(enrichedBundle.title);
    const notePath = path.join(this.vaultDir, fileName);
    const noteContent = this._renderNote(enrichedBundle);
    await fsp.writeFile(notePath, noteContent, 'utf-8');

    let patternPath = null;
    if (enrichedBundle.pattern) {
      patternPath = await this.writePattern(
        enrichedBundle.pattern.name || enrichedBundle.title,
        this._renderPattern(enrichedBundle)
      );
    }

    let skillNoteId = null;
    if (enrichedBundle.skill && this.zk) {
      const skillName = enrichedBundle.skill.name || enrichedBundle.title;
      skillNoteId = this._slugify(skillName);
      const existing = this.zk.getNote ? await this.zk.getNote(skillNoteId) : null;

      if (!existing && this.zk.createNote) {
        await this.zk.createNote({
          name: skillName,
          code: enrichedBundle.skill.code || '',
          description: enrichedBundle.skill.description || enrichedBundle.lesson,
          errorType: enrichedBundle.skill.errorType || 'workflow:knowledge-capture',
          agentId: enrichedBundle.author,
        });
      }
    }

    const section = enrichedBundle.outcome === 'failed' ? 'Learning Wall' : 'Recent Achievements';
    await this.addDashboardLink(section, `[[${path.basename(notePath, '.md')}]] - ${enrichedBundle.title}`);

    if (enrichedBundle.taskId && this.board.setConfig) {
      await this.board.setConfig(
        `knowledge:task:${enrichedBundle.projectId}:${enrichedBundle.taskId}:latest`,
        {
          projectId: enrichedBundle.projectId,
          taskId: enrichedBundle.taskId,
          title: enrichedBundle.title,
          summary: enrichedBundle.summary,
          lesson: enrichedBundle.lesson,
          outcome: enrichedBundle.outcome,
          notePath,
          retryCategory: enrichedBundle.retryCategory || null,
          retryGuardrail: enrichedBundle.retryGuardrail || null,
          improvementNote: enrichedBundle.improvementNote || null,
          capturedAt,
        }
      );
    }

    const promotionCandidate = this._buildPromotionCandidate(enrichedBundle, notePath);
    if (promotionCandidate && this.board.setConfig) {
      await this.board.setConfig(
        `knowledge:promotion:${promotionCandidate.projectId}:${promotionCandidate.taskId}:candidate`,
        promotionCandidate
      );
    }

    await this.board.publish('knowledge:capture:stored', {
      author: enrichedBundle.author,
      projectId: enrichedBundle.projectId,
      taskId: enrichedBundle.taskId || null,
      title: enrichedBundle.title,
      notePath,
      outcome: enrichedBundle.outcome,
      retryCategory: enrichedBundle.retryCategory || null,
      retryGuardrail: enrichedBundle.retryGuardrail || null,
      continuationTaskId: enrichedBundle.continuationTaskId || null,
      improvementNote: enrichedBundle.improvementNote || null,
      capturedAt,
    });

    if (promotionCandidate) {
      await this.board.publish('knowledge:promotion:candidate', promotionCandidate);
    }

    if (this.logger) {
      await this.logger.logEvent('knowledge-operator', {
        type: 'capture_stored',
        projectId: enrichedBundle.projectId,
        title: enrichedBundle.title,
        outcome: enrichedBundle.outcome,
        notePath,
      });
    }

    return { notePath, patternPath, skillNoteId };
  }

  _buildPromotionCandidate(bundle, notePath) {
    if (
      bundle.outcome !== 'passed'
      || !bundle.taskId
      || !bundle.retryGuardrail
      || !bundle.retryCategory
      || !bundle.dryRunSummary
    ) {
      return null;
    }

    return {
      author: bundle.author,
      projectId: bundle.projectId,
      taskId: bundle.taskId,
      title: bundle.title,
      notePath,
      promotionType: 'dry-run-recovery-play',
      status: 'queued',
      retryCategory: bundle.retryCategory,
      retryGuardrail: bundle.retryGuardrail,
      dryRunSummary: bundle.dryRunSummary,
      improvementNote: bundle.improvementNote || null,
      capturedAt: bundle.capturedAt || new Date().toISOString(),
    };
  }

  async markPromotionApplied({ author, projectId, taskId, promotedTo }) {
    if (!author || !projectId || !taskId || !promotedTo) {
      throw new Error('[KnowledgeOperator] author, projectId, taskId, and promotedTo are required');
    }

    if (!this.board.getConfig || !this.board.setConfig) {
      throw new Error('[KnowledgeOperator] board config support is required');
    }

    const key = `knowledge:promotion:${projectId}:${taskId}:candidate`;
    const existing = await this.board.getConfig(key);
    if (!existing) {
      throw new Error(`[KnowledgeOperator] promotion candidate not found for ${projectId}/${taskId}`);
    }

    const updated = {
      ...existing,
      author,
      status: 'promoted',
      promotedTo,
      promotedAt: new Date().toISOString(),
    };

    if (promotedTo === 'obsidian-pattern') {
      const patternName = existing.dryRunSummary || existing.title;
      updated.patternPath = await this.writePattern(
        patternName,
        this._renderPromotedPattern(existing)
      );
    }

    if (promotedTo === 'notebooklm-source') {
      const notebookKey = `knowledge:notebooklm:${projectId}:${taskId}:queued`;
      const notebookQueue = {
        author,
        projectId,
        taskId,
        sourcePath: existing.notePath,
        queueType: 'promotion-source',
        sourceTitle: existing.title,
        status: 'queued',
        queuedAt: new Date().toISOString(),
      };
      await this.board.setConfig(notebookKey, notebookQueue);
      await this.board.publish('knowledge:notebooklm:queued', notebookQueue);
    }

    await this.board.setConfig(key, updated);
    await this.board.publish('knowledge:promotion:applied', {
      author,
      projectId,
      taskId,
      promotionType: updated.promotionType,
      promotedTo,
    });

    return updated;
  }

  _renderPromotedPattern(candidate) {
    return `# ${candidate.dryRunSummary || candidate.title}

## Source

- Project: ${candidate.projectId}
- Task: ${candidate.taskId}
- Note: ${candidate.notePath}

## Pattern

${candidate.dryRunSummary || candidate.title}

## Guardrail Recovered

- Category: ${candidate.retryCategory || 'unknown'}
- Guardrail: ${candidate.retryGuardrail || 'unknown'}

## Improvement

${candidate.improvementNote || 'Promotion candidate created from a successful retry recovery.'}
`;
  }

  async handleReviewApproved(message) {
    const data = this._parseMessage(message);
    return this.capture({
      author: 'knowledge-operator',
      projectId: data.projectId,
      title: `Approved ${data.taskId}`,
      taskId: data.taskId,
      summary: `Task ${data.taskId} was approved in ${data.file}.`,
      outcome: 'passed',
      verification: [`review approval event for ${data.file}`],
      lesson: 'Approved work should be converted into a reusable reference point.',
      tags: ['governance', 'approved', 'auto-capture'],
    });
  }

  async handleRetryRequested(message) {
    const data = this._parseMessage(message);
    return this.capture({
      author: 'knowledge-operator',
      projectId: data.projectId,
      title: `Retry ${data.taskId}`,
      taskId: data.taskId,
      summary: `Failure category ${data.category} triggered a retry request.`,
      outcome: 'failed',
      verification: [`failure retry requested with guardrail ${data.guardrail}`],
      lesson: `Guardrail ${data.guardrail} needs reinforcement before the next retry.`,
      retryCategory: data.category,
      retryGuardrail: data.guardrail,
      continuationTaskId: data.taskId,
      tags: ['governance', 'failure', 'auto-capture'],
    });
  }

  async handleTaskCompleted(message) {
    const data = this._parseMessage(message);
    const taskState = this.board.getConfig
      ? await this.board.getConfig(`tasks:${data.projectId}:${data.taskId}`)
      : null;

    const summary = taskState
      ? `Task ${data.taskId} completed for goal: ${taskState.goal}. Workspace: ${taskState.workspacePath}.`
      : `Task ${data.taskId} completed with ${data.verificationCount} verification checks.`;
    const dryRunSummary = Array.isArray(taskState?.dryRuns) && taskState.dryRuns.length > 0
      ? taskState.dryRuns.at(-1).summary
      : null;
    const verification = Array.isArray(taskState?.verification) && taskState.verification.length > 0
      ? taskState.verification
      : [`${data.verificationCount} verification checks recorded`];
    const retryCategory = taskState?.retry?.category || null;
    const retryGuardrail = taskState?.retry?.guardrail || null;
    const improvementNote = retryGuardrail
      ? `Resolved guardrail ${retryGuardrail} after ${retryCategory || 'workflow'} retry${taskState?.retry?.count > 1 ? ` (${taskState.retry.count} attempts total)` : ''}.`
      : null;

    return this.capture({
      author: 'knowledge-operator',
      projectId: data.projectId,
      title: `Completed ${data.taskId}`,
      taskId: data.taskId,
      summary,
      outcome: 'passed',
      verification,
      lesson: dryRunSummary
        ? `Completed tasks should become durable project memory with verification attached. Latest dry-run: ${dryRunSummary}`
        : 'Completed tasks should become durable project memory with verification attached.',
      dryRunSummary,
      retryCategory,
      retryGuardrail,
      continuationTaskId: data.taskId,
      improvementNote,
      tags: ['governance', 'task-complete', 'auto-capture', improvementNote ? 'retry-resolved' : null].filter(Boolean),
    });
  }

  async handleSkillEvalCompleted(message) {
    const data = this._parseMessage(message);
    const outcome = data.passed ? 'passed' : 'failed';
    const findings = Number.isInteger(data.findingCount)
      ? data.findingCount
      : Array.isArray(data.findings) ? data.findings.length : 0;

    return this.capture({
      author: 'knowledge-operator',
      projectId: 'skills',
      title: `Skill eval ${data.skillName}`,
      summary: `Skill ${data.skillName} evaluated at score ${data.score}.`,
      outcome,
      verification: [`skill eval score ${data.score}`, `${findings} structural findings`],
      lesson: data.passed
        ? 'Strong skills should still be tracked so their structure can become the reusable baseline.'
        : 'Failing skill evaluations should turn into visible debt and a remediation target.',
      tags: ['knowledge', 'skill-eval', outcome],
    });
  }

  _validateBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') {
      throw new Error('[KnowledgeOperator] capture bundle is required');
    }

    const required = ['author', 'projectId', 'title', 'summary', 'outcome', 'lesson'];
    for (const field of required) {
      if (!bundle[field]) {
        throw new Error(`[KnowledgeOperator] ${field} is required`);
      }
    }

    if (!Array.isArray(bundle.verification) || bundle.verification.length === 0) {
      throw new Error('[KnowledgeOperator] verification evidence is required');
    }
  }

  _renderNote(bundle) {
    const capturedAt = bundle.capturedAt || new Date().toISOString();
    const tags = [...(bundle.tags || []), 'knowledge-capture', bundle.outcome]
      .filter(Boolean)
      .map((tag) => `"${tag}"`)
      .join(', ');
    const verification = bundle.verification.map((item) => `- ${item}`).join('\n');

    return `---
project: "${bundle.projectId}"
task_id: "${bundle.taskId || ''}"
title: "${bundle.title}"
outcome: "${bundle.outcome}"
author: "${bundle.author}"
tags: [${tags}]
captured_at: "${capturedAt}"
---

# ${bundle.title}

## Summary
${bundle.summary}

## Verification
${verification}

## Lesson
${bundle.lesson}
${bundle.improvementNote ? `\n## Improvement\n${bundle.improvementNote}\n` : ''}
`;
  }

  _renderPattern(bundle) {
    const patternName = bundle.pattern.name || bundle.title;
    const patternSummary = bundle.pattern.summary || bundle.lesson;
    const verification = bundle.verification.map((item) => `- ${item}`).join('\n');

    return `# ${patternName}

## Why It Exists
${patternSummary}

## Verification Signals
${verification}

## Reuse Rule
Apply this pattern when work should become a durable note, evidence, and a reusable lesson in one pass.
`;
  }

  _parseMessage(message) {
    if (typeof message === 'string') {
      return JSON.parse(message);
    }
    return message;
  }

  _buildFileName(title) {
    return `${this._slugify(title)}.md`;
  }

  _slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}

module.exports = {
  KnowledgeOperator,
  DEFAULT_VAULT_DIR,
};
