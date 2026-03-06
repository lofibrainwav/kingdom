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
}

module.exports = {
  TaskRunner,
  DEFAULT_WORKSPACE_ROOT,
};
