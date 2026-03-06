const fsp = require('fs').promises;
const path = require('path');
const { Blackboard } = require('./blackboard');

const DEFAULT_WORKSPACE_ROOT = path.join(__dirname, '..', '..', 'workspace');

class TaskRunner {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.workspaceRoot = options.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  }

  async init() {
    if (this.board.connect && this.board.client && !this.board.client.isOpen) {
      await this.board.connect();
    }

    await fsp.mkdir(this.workspaceRoot, { recursive: true });
  }

  getWorkspacePath(projectId, taskId) {
    return path.join(
      this.workspaceRoot,
      this._safeSegment(projectId),
      this._safeSegment(taskId)
    );
  }

  async startTask({ author, projectId, taskId, goal, skillsToEvaluate = [], reviewArtifacts = [] }) {
    this._validateTaskInput({ author, projectId, taskId, goal });
    const workspacePath = this.getWorkspacePath(projectId, taskId);
    await fsp.mkdir(workspacePath, { recursive: true });

    const state = {
      projectId,
      taskId,
      goal,
      status: 'started',
      workspacePath,
      skillsToEvaluate,
      reviewArtifacts,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.board.setConfig(this._taskConfigKey(projectId, taskId), state);
    await this.board.batchPublish([
      {
        channel: 'work:task:started',
        data: { author, projectId, taskId, goal },
      },
      {
        channel: 'execution:task:workspace-ready',
        data: { author, projectId, taskId, workspacePath },
      },
    ]);

    return state;
  }

  async completeTask({ author, projectId, taskId, verification }) {
    this._validateTaskClosure({ author, projectId, taskId, verification });
    const key = this._taskConfigKey(projectId, taskId);
    const current = await this.board.getConfig(key);
    if (!current) {
      throw new Error(`[TaskRunner] task state not found for ${projectId}/${taskId}`);
    }

    const updated = {
      ...current,
      status: 'completed',
      verification,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.board.setConfig(key, updated);
    await this.board.publish('governance:task:completed', {
      author,
      projectId,
      taskId,
      verificationCount: verification.length,
    });

    return updated;
  }

  async failTask({ author, projectId, taskId, category, guardrail }) {
    if (!author || !projectId || !taskId || !category || !guardrail) {
      throw new Error('[TaskRunner] author, projectId, taskId, category, and guardrail are required');
    }

    const key = this._taskConfigKey(projectId, taskId);
    const current = await this.board.getConfig(key);
    if (!current) {
      throw new Error(`[TaskRunner] task state not found for ${projectId}/${taskId}`);
    }

    const updated = {
      ...current,
      status: 'failed',
      failure: { category, guardrail, failedAt: Date.now() },
      updatedAt: Date.now(),
    };

    await this.board.setConfig(key, updated);
    await this.board.publish('governance:failure:retry-requested', {
      author,
      projectId,
      taskId,
      category,
      guardrail,
    });

    return updated;
  }

  async recordDryRun({ author, projectId, taskId, summary, verification, outcome = 'passed' }) {
    if (!author || !projectId || !taskId || !summary) {
      throw new Error('[TaskRunner] author, projectId, taskId, and summary are required for dry-run records');
    }
    if (!Array.isArray(verification) || verification.length === 0) {
      throw new Error('[TaskRunner] dry-run verification evidence is required');
    }

    const updated = await this._patchTaskState(projectId, taskId, (current) => ({
      ...current,
      dryRuns: [
        ...(current.dryRuns || []),
        {
          summary,
          verification,
          outcome,
          author,
          recordedAt: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    }));

    await this.board.publish('work:dry-run:recorded', {
      author,
      projectId,
      taskId,
      summary,
      outcome,
      verificationCount: verification.length,
    });

    return updated;
  }

  async listTasks({ projectId, taskId, status, retryGuardrail, retryCategory } = {}) {
    if (!this.board.listConfigs) {
      return [];
    }

    const prefix = projectId ? `tasks:${projectId}:` : 'tasks:';
    const entries = await this.board.listConfigs(prefix);
    return entries
      .map(({ key, value }) => ({
        key,
        ...value,
      }))
      .filter((task) => {
        if (taskId && task.taskId !== taskId) {
          return false;
        }
        if (status && task.status !== status) {
          return false;
        }
        if (retryGuardrail && task.retry?.guardrail !== retryGuardrail) {
          return false;
        }
        if (retryCategory && task.retry?.category !== retryCategory) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0);
        if (updatedDelta !== 0) {
          return updatedDelta;
        }

        const startedDelta = (b.startedAt || 0) - (a.startedAt || 0);
        if (startedDelta !== 0) {
          return startedDelta;
        }

        return String(b.taskId || '').localeCompare(String(a.taskId || ''));
      });
  }

  async markReviewRequested({ projectId, taskId, file }) {
    return this._patchTaskState(projectId, taskId, (current) => ({
      ...current,
      review: {
        ...(current.review || {}),
        status: 'requested',
        file,
        requestedAt: Date.now(),
      },
      updatedAt: Date.now(),
    }));
  }

  async markReviewApproved({ projectId, taskId, file }) {
    return this._patchTaskState(projectId, taskId, (current) => ({
      ...current,
      status: 'approved',
      review: {
        ...(current.review || {}),
        status: 'approved',
        file,
        approvedAt: Date.now(),
      },
      updatedAt: Date.now(),
    }));
  }

  async markReviewRejected({ projectId, taskId, file, feedback }) {
    return this._patchTaskState(projectId, taskId, (current) => ({
      ...current,
      status: 'changes_requested',
      review: {
        ...(current.review || {}),
        status: 'rejected',
        file,
        feedback,
        rejectedAt: Date.now(),
      },
      updatedAt: Date.now(),
    }));
  }

  async markRetryRequested({ projectId, taskId, category, guardrail }) {
    return this._patchTaskState(projectId, taskId, (current) => ({
      ...current,
      status: 'retry_requested',
      retry: {
        ...(current.retry || {}),
        category,
        guardrail,
        requestedAt: Date.now(),
        count: (current.retry?.count || 0) + 1,
      },
      updatedAt: Date.now(),
    }));
  }

  async markRetryHandedOff({ projectId, taskId, channel, author }) {
    return this._patchTaskState(projectId, taskId, (current) => ({
      ...current,
      retry: {
        ...(current.retry || {}),
        handoff: {
          status: 'queued',
          channel,
          author,
          queuedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    }));
  }

  async markRetryClaimed({ projectId, taskId, agentId }) {
    return this._patchTaskState(projectId, taskId, (current) => ({
      ...current,
      status: 'replanning',
      retry: {
        ...(current.retry || {}),
        handoff: {
          ...(current.retry?.handoff || {}),
          status: 'claimed',
          claimedBy: agentId,
          claimedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    }));
  }

  _taskConfigKey(projectId, taskId) {
    return `tasks:${projectId}:${taskId}`;
  }

  _safeSegment(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
  }

  _validateTaskInput({ author, projectId, taskId, goal }) {
    if (!author || !projectId || !taskId || !goal) {
      throw new Error('[TaskRunner] author, projectId, taskId, and goal are required');
    }
  }

  _validateTaskClosure({ author, projectId, taskId, verification }) {
    if (!author || !projectId || !taskId) {
      throw new Error('[TaskRunner] author, projectId, and taskId are required');
    }

    if (!Array.isArray(verification) || verification.length === 0) {
      throw new Error('[TaskRunner] verification evidence is required before completion');
    }
  }

  async _patchTaskState(projectId, taskId, updater) {
    const key = this._taskConfigKey(projectId, taskId);
    const current = await this.board.getConfig(key);
    if (!current) {
      throw new Error(`[TaskRunner] task state not found for ${projectId}/${taskId}`);
    }

    const updated = updater(current);
    await this.board.setConfig(key, updated);
    return updated;
  }
}

module.exports = {
  TaskRunner,
  DEFAULT_WORKSPACE_ROOT,
};
