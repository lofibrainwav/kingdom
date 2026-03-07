const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { CoderAgent } = require('../agent/team/coder');

describe('CoderAgent', () => {
  let configs;
  let published;
  let statuses;
  let board;
  let llm;
  let writtenFiles;
  let agent;

  beforeEach(() => {
    configs = new Map();
    published = [];
    statuses = [];
    writtenFiles = [];

    board = {
      connect: async () => {},
      disconnect: async () => {},
      createSubscriber: async () => ({
        on: () => {},
        subscribe: async () => {},
        disconnect: async () => {},
      }),
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      getConfig: async (key) => configs.get(key) || null,
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
      updateStatus: async (agentId, status) => {
        statuses.push({ agentId, status });
      },
    };

    llm = {
      init: async () => {},
      shutdown: async () => {},
      callLLM: async () => 'console.log("generated code");',
    };

    agent = new CoderAgent();
    agent.board = board;
    agent.llm = llm;

    // Mock fs.promises to avoid real file I/O
    const fspMock = {
      mkdir: async () => {},
      writeFile: async (filePath, content) => {
        writtenFiles.push({ filePath, content });
      },
    };
    // Patch the module-level fsp by overriding handlePlanComplete's file ops
    const origHandle = agent.handlePlanComplete.bind(agent);
    agent.handlePlanComplete = async function (message) {
      const fsp = require('fs').promises;
      const origMkdir = fsp.mkdir;
      const origWrite = fsp.writeFile;
      fsp.mkdir = fspMock.mkdir;
      fsp.writeFile = fspMock.writeFile;
      try {
        await origHandle(message);
      } finally {
        fsp.mkdir = origMkdir;
        fsp.writeFile = origWrite;
      }
    };
  });

  it('init subscribes to 3 channels and sets idle status', async () => {
    const channels = [];
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { channels.push(channel); },
      disconnect: async () => {},
    });

    await agent.init();

    assert.equal(channels.length, 3);
    assert.ok(channels.includes('work:planning:decomposed'));
    assert.ok(channels.includes('governance:teamlead:vibe-translated'));
    assert.ok(channels.includes('knowledge:got:completed'));
    assert.equal(statuses.at(-1).agentId, 'Kingdom_Coder');
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('handlePlanComplete processes tasks, writes files, and requests review', async () => {
    let llmCalls = 0;
    llm.callLLM = async () => {
      llmCalls++;
      return `// code for task ${llmCalls}`;
    };

    await agent.handlePlanComplete({
      projectId: 'project:app-01',
      goal: 'Build an API',
      tasks: {
        tasks: [
          { id: 'T1', description: 'Create REST endpoints', dependencyId: null },
          { id: 'T2', description: 'Add auth middleware', dependencyId: 'T1' },
        ],
      },
    });

    // LLM called for each task
    assert.equal(llmCalls, 2);

    // Files written
    assert.equal(writtenFiles.length, 2);

    // Config saved for each task (uses tasks: prefix for TaskRunner compatibility)
    assert.ok(configs.has('tasks:project:app-01:T1'));
    assert.ok(configs.has('tasks:project:app-01:T2'));

    // Review requested for each task
    assert.equal(published.length, 2);
    assert.equal(published[0].channel, 'governance:review:requested');
    assert.equal(published[0].data.taskId, 'T1');
    assert.equal(published[1].channel, 'governance:review:requested');
    assert.equal(published[1].data.taskId, 'T2');

    // Status: coding -> coding -> idle
    const codingStatuses = statuses.filter(s => s.status.state === 'coding');
    assert.equal(codingStatuses.length, 2);
    assert.equal(statuses.at(-1).status.state, 'idle');
  });

  it('_absorbVibePatch stores guardrails from vibe translation', () => {
    agent._absorbVibePatch({
      patterns: [
        { guardrail: 'Always use camelCase', gap: 'naming' },
        { guardrail: 'Add input validation', gap: 'security' },
      ],
    });

    assert.equal(agent.vibePatches.length, 2);
    assert.equal(agent.vibePatches[0].guardrail, 'Always use camelCase');
    assert.equal(agent.vibePatches[1].gap, 'security');
  });

  it('_absorbVibePatch handles JSON string input', () => {
    agent._absorbVibePatch(JSON.stringify({
      patterns: [{ guardrail: 'Use strict mode', gap: 'safety' }],
    }));

    assert.equal(agent.vibePatches.length, 1);
    assert.equal(agent.vibePatches[0].guardrail, 'Use strict mode');
  });

  it('_absorbVibePatch caps at 10 patches', () => {
    for (let i = 0; i < 15; i++) {
      agent._absorbVibePatch({ patterns: [{ guardrail: `rule-${i}` }] });
    }
    assert.equal(agent.vibePatches.length, 10);
    assert.equal(agent.vibePatches[0].guardrail, 'rule-5');
  });

  it('_absorbSkillSynergies stores synergy data', () => {
    agent._absorbSkillSynergies({
      synergies: [
        { combo: 'TDD+Security', insight: 'Test security paths first' },
      ],
    });

    assert.equal(agent.skillSynergies.length, 1);
    assert.equal(agent.skillSynergies[0].combo, 'TDD+Security');
  });

  it('_absorbSkillSynergies caps at 10 synergies', () => {
    for (let i = 0; i < 12; i++) {
      agent._absorbSkillSynergies({ synergies: [{ combo: `s-${i}`, insight: 'x' }] });
    }
    assert.equal(agent.skillSynergies.length, 10);
  });

  it('_buildFeedbackContext returns empty string when no patches', () => {
    assert.equal(agent._buildFeedbackContext(), '');
  });

  it('_buildFeedbackContext includes vibe patches and synergies', () => {
    agent.vibePatches = [{ guardrail: 'Use camelCase', gap: 'naming' }];
    agent.skillSynergies = [{ combo: 'TDD+Refactor', insight: 'Refactor after green' }];

    const ctx = agent._buildFeedbackContext();
    assert.equal(ctx.includes('Use camelCase'), true);
    assert.equal(ctx.includes('naming'), true);
    assert.equal(ctx.includes('TDD+Refactor'), true);
    assert.equal(ctx.includes('Refactor after green'), true);
  });

  it('handlePlanComplete injects feedback context into LLM prompt', async () => {
    let capturedPrompt = '';
    llm.callLLM = async (prompt) => { capturedPrompt = prompt; return '// code'; };
    agent.vibePatches = [{ guardrail: 'Always validate input', gap: 'security' }];

    await agent.handlePlanComplete({
      projectId: 'proj-1',
      goal: 'Build API',
      tasks: { tasks: [{ id: 'T1', description: 'Create endpoint' }] },
    });

    assert.equal(capturedPrompt.includes('Always validate input'), true);
    assert.equal(capturedPrompt.includes('guardrails from recent reviews'), true);
  });

  it('shutdown disconnects subscriber, board, and LLM', async () => {
    let subDisconnected = false;
    let boardDisconnected = false;
    let llmShutdown = false;

    agent.subscriber = { disconnect: async () => { subDisconnected = true; } };
    board.disconnect = async () => { boardDisconnected = true; };
    llm.shutdown = async () => { llmShutdown = true; };

    await agent.shutdown();

    assert.equal(subDisconnected, true);
    assert.equal(boardDisconnected, true);
    assert.equal(llmShutdown, true);
  });
});
