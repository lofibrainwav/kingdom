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
    return this.taskRunner.markReviewApproved(data);
  }

  async handleReviewRejected(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : message;
    return this.taskRunner.markReviewRejected(data);
  }

  async handleRetryRequested(message) {
    const data = typeof message === 'string' ? JSON.parse(message) : message;
    return this.taskRunner.markRetryRequested(data);
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
    };
  }
}

module.exports = {
  TaskCloseoutOrchestrator,
};
