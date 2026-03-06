const { Blackboard } = require('./blackboard');
const { SkillEvaluator } = require('./skill-evaluator');
const { TaskRunner } = require('./task-runner');

class TaskCloseoutOrchestrator {
  constructor(options = {}) {
    this.board = options.board || new Blackboard();
    this.skillEvaluator = options.skillEvaluator || new SkillEvaluator({ board: this.board });
    this.taskRunner = options.taskRunner || new TaskRunner({ board: this.board });
    this.subscriber = null;
  }

  async init() {
    if (this.board.connect && this.board.client && !this.board.client.isOpen) {
      await this.board.connect();
    }
  }

  async start() {
    this.subscriber = await this.board.createSubscriber();
    if (this.subscriber.on) {
      this.subscriber.on('error', () => {});
    }

    await this.subscriber.subscribe('governance:task:completed', async (message) => {
      await this.handleTaskCompleted(message);
    });

    await this.subscriber.subscribe('governance:review:approved', async (message) => {
      await this.handleReviewApproved(message);
    });

    await this.subscriber.subscribe('governance:review:rejected', async (message) => {
      await this.handleReviewRejected(message);
    });

    await this.subscriber.subscribe('governance:failure:retry-requested', async (message) => {
      await this.handleRetryRequested(message);
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

  async handleTaskCompleted(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : message;
    const taskState = this.board.getConfig
      ? await this.board.getConfig(`tasks:${data.projectId}:${data.taskId}`)
      : null;
    const reviewPayload = this._buildReviewPayload(data, taskState);
    await this.taskRunner.markReviewRequested(reviewPayload);
    await this.board.publish('governance:review:requested', reviewPayload);

    const skillsToEvaluate = Array.isArray(taskState?.skillsToEvaluate)
      ? taskState.skillsToEvaluate
      : [];

    const evaluations = [];
    for (const skillName of skillsToEvaluate) {
      evaluations.push(await this.skillEvaluator.evaluateSkill(skillName));
    }

    return {
      reviewRequested: true,
      evaluatedSkills: evaluations,
    };
  }

  async handleReviewApproved(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : message;
    const result = await this.taskRunner.markReviewApproved(data);

    // Check if all tasks in the project are now approved
    if (data.projectId && this.taskRunner.listTasks) {
      const tasks = await this.taskRunner.listTasks({ projectId: data.projectId });
      const allApproved = tasks.length > 0 && tasks.every((t) => t.status === 'approved');
      if (allApproved) {
        const goal = tasks[0]?.goal || `Project ${data.projectId} completed`;
        await this.board.publish('governance:project:approved', {
          projectId: data.projectId,
          goal,
          author: data.author || 'task-closeout-orchestrator',
        });
      }
    }

    return result;
  }

  async handleReviewRejected(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : message;
    return this.taskRunner.markReviewRejected(data);
  }

  async handleRetryRequested(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : message;
    const updated = await this.taskRunner.markRetryRequested(data);
    const intakePayload = this._buildRetryIntakePayload(data, updated);

    await this.board.publish('work:intake', intakePayload);
    await this.taskRunner.markRetryHandedOff({
      projectId: data.projectId,
      taskId: data.taskId,
      channel: 'work:intake',
      author: data.author || 'task-closeout-orchestrator',
    });

    return updated;
  }

  _buildReviewPayload(eventData, taskState) {
    const reviewArtifact = Array.isArray(taskState?.reviewArtifacts) && taskState.reviewArtifacts.length > 0
      ? taskState.reviewArtifacts[0]
      : null;

    const file = reviewArtifact?.file || taskState?.workspacePath || `task:${eventData.taskId}`;
    const content = JSON.stringify({
      goal: taskState?.goal || null,
      verification: taskState?.verification || [],
      reviewArtifacts: taskState?.reviewArtifacts || [],
      verificationCount: eventData.verificationCount,
    });

    return {
      projectId: eventData.projectId,
      taskId: eventData.taskId,
      file,
      content,
      author: eventData.author || 'task-closeout-orchestrator',
    };
  }

  _buildRetryIntakePayload(eventData, taskState) {
    const task = `Retry ${eventData.taskId}: ${taskState?.goal || eventData.category || 'recover failed work'}`;

    return {
      author: eventData.author || 'task-closeout-orchestrator',
      task,
      projectId: eventData.projectId,
      taskId: eventData.taskId,
      retry: true,
      retryCategory: eventData.category,
      retryGuardrail: eventData.guardrail,
      goal: taskState?.goal || null,
      workspacePath: taskState?.workspacePath || null,
    };
  }
}

module.exports = {
  TaskCloseoutOrchestrator,
};
