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

  it('init subscribes to work:planning:decomposed and sets idle status', async () => {
    let subscribedChannel = null;
    board.createSubscriber = async () => ({
      on: () => {},
      subscribe: async (channel) => { subscribedChannel = channel; },
      disconnect: async () => {},
    });

    await agent.init();

    assert.equal(subscribedChannel, 'work:planning:decomposed');
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

    // Config saved for each task
    assert.ok(configs.has('project:app-01:task:T1:done'));
    assert.ok(configs.has('project:app-01:task:T2:done'));

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

  it('shutdown disconnects subscriber, board, and LLM', async () => {
    let subDisconnected = false;
    let boardDisconnected = false;
    let llmShutdown = false;

    agent.subscriber = { disconnect: async () => { subDisconnected = true; } };
    board.disconnect = async () => { boardDisconnected = true; };
    llm.shutdown = async () => { llmShutdown = true; };

    await agent.shutdown();

    assert.ok(subDisconnected);
    assert.ok(boardDisconnected);
    assert.ok(llmShutdown);
  });
});
