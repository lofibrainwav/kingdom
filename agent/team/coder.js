/**
 * Kingdom Coder Agent — Phase 3.1
 * Responsible for:
 * 1. Pulling tasks from the project plan in Blackboard
 * 2. Implementing code in the workspace/[project] directory
 * 3. Handling TDD loop (Create -> Test -> Fix)
 */
const { Blackboard } = require('../core/blackboard');
const { getLogger } = require('../core/logger');
const { ReflexionEngine } = require('../core/ReflexionEngine');
const fsp = require('fs').promises;
const path = require('path');
const log = getLogger();

class CoderAgent {
  constructor() {
    this.board = new Blackboard();
    this.llm = new ReflexionEngine();
    this.agentId = 'Kingdom_Coder';
    this.baseWorkspace = path.join(__dirname, '..', '..', 'workspace');
  }

  async init() {
    await this.board.connect();
    await this.llm.init();
    this.subscriber = await this.board.createSubscriber();
    this.subscriber.on('error', (err) => log.error('coder', 'Redis sub error', { error: err.message }));
    
    // Listen for decomposition complete from Decomposer
    await this.subscriber.subscribe('work:planning:decomposed', async (msg) => {
      try { await this.handlePlanComplete(msg); } catch (err) { log.error(this.agentId, 'subscribe handler error', { error: err.message }); }
    });
    
    log.info(this.agentId, 'initialized and ready to build');
    await this.updateStatus('idle', 'Waiting for task plans');
  }

  async handlePlanComplete(message) {
    try {
      const {
        projectId,
        goal,
        tasks,
        taskId: continuationTaskId = null,
        retry = false,
        retryCategory = null,
        retryGuardrail = null,
      } = typeof message === 'string' ? JSON.parse(message) : message;
      log.info(this.agentId, `Starting build for project ${projectId}: ${goal}`);
      
      const projectPath = path.join(this.baseWorkspace, projectId.replace(/:/g, '_'));
      await fsp.mkdir(projectPath, { recursive: true });

      // tasks is { tasks: [{id, description, dependencyId}] }
      const taskList = tasks.tasks || [];
      
      for (const task of taskList) {
        log.info(this.agentId, `Executing task ${task.id}: ${task.description}`);
        await this.updateStatus('coding', `Task ${task.id}: ${task.description.slice(0, 30)}`);

        // 1. Generate Code via LLM
        const codeResponse = await this.llm.callLLM(
          `Implement this task for project ${projectId}:\n${task.description}\n` +
          `Project Goal: ${goal}\n` +
          'Return purely the file content. If multiple files, use a clear delimiter like // --- FILE: filename ---',
          'normal'
        );

        if (!codeResponse) {
          log.warn(this.agentId, `LLM returned null for task ${String(task.id ?? 'unknown')}, skipping`);
          continue;
        }

        // 2. Write to Workspace
        // (Simplified: assuming single file for now, or parsing delimiters)
        const fileName = `task_${String(task.id ?? 'unknown').replace(/\s+/g, '_')}.js`;
        await fsp.writeFile(path.join(projectPath, fileName), codeResponse);

        // 3. Mark Task as Done in Blackboard (uses tasks: prefix for TaskRunner compatibility)
        await this.board.setConfig(`tasks:${projectId}:${task.id}`, {
          projectId,
          taskId: task.id,
          goal: task.description,
          status: 'review-requested',
          completedAt: Date.now(),
          file: fileName,
          continuationTaskId,
          retry,
          retryCategory,
          retryGuardrail,
        });

        // 4. Trigger Reviewer for this task
        await this.board.publish('governance:review:requested', {
          projectId,
          taskId: task.id,
          file: fileName,
          content: codeResponse,
          continuationTaskId,
          retry,
          retryCategory,
          retryGuardrail,
          author: this.agentId,
        });
      }

      log.info(this.agentId, `Project ${projectId} build sequence completed`);
      await this.updateStatus('idle', `Finished all tasks for ${projectId}`);
    } catch (err) {
      log.error(this.agentId, 'Build failed', { error: err.message });
      await this.updateStatus('idle', `Error: ${err.message}`);
    }
  }

  async updateStatus(state, details) {
    await this.board.updateStatus(this.agentId, {
      state,
      task: details,
      health: 20,
      lastUpdate: Date.now()
    });
  }

  async shutdown() {
    if (this.subscriber) await this.subscriber.disconnect();
    await this.board.disconnect();
    await this.llm.shutdown();
  }
}

if (require.main === module) {
  const coder = new CoderAgent();
  coder.init().catch(err => {
    log.error('Kingdom_Coder', 'Startup failed', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await coder.shutdown();
    process.exit(0);
  });
}

module.exports = { CoderAgent };
