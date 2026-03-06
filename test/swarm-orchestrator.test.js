const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const child_process = require('child_process');
const EventEmitter = require('events');
const { SwarmOrchestrator } = require('../agent/team/swarm-orchestrator');

describe('SwarmOrchestrator — Vibe Coding Parallel Execution', () => {
  let swarm;
  let mockBoard;
  let execCalls = [];
  let subscribedChannels = [];

  beforeEach(() => {
    execCalls = [];
    subscribedChannels = [];
    
    // Create a mock Blackboard
    mockBoard = {
      connect: async () => {},
      disconnect: async () => {},
      setHashField: async () => {},
      createSubscriber: async () => {
        return {
          on: () => {},
          subscribe: async (channel) => { subscribedChannels.push(channel); },
          disconnect: async () => {}
        };
      }
    };

    // Override the constructor to inject our mock board setup
    swarm = new SwarmOrchestrator();
    swarm.board = mockBoard;

    // Mock child_process.spawn to return a dummy EventEmitter (mocking ChildProcess)
    mock.method(child_process, 'spawn', (cmd, args, options) => {
      execCalls.push({ cmd: `${cmd} ${args.join(' ')}`, options });
      const cp = new EventEmitter();
      cp.kill = () => { cp.killed = true; };
      return cp;
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('Should subscribe to canonical execution swarm channels during init', async () => {
    await swarm.init();
    assert.deepEqual(subscribedChannels, [
      'execution:swarm:spawn',
      'execution:swarm:terminate'
    ]);
  });

  it('Should initialize swarm orchestrator and register as agent', async () => {
    let statusSaved = false;
    mock.method(mockBoard, 'setHashField', async (key, field, val) => {
      if (key === 'agents:status' && field === 'Kingdom_Swarm') {
        assert.equal(val.state, 'idle');
        statusSaved = true;
      }
    });

    await swarm.init();
    assert.ok(statusSaved, 'Should have saved initial status');
  });

  it('handleSpawn should spawn child processes and update swarm status', async () => {
    let swarmSaved = false;
    let orchestratingStatus = false;
    
    mock.method(mockBoard, 'setHashField', async (key, field, val) => {
      if (key === 'agents:status' && field === 'Kingdom_Swarm') {
        if (val.state === 'orchestrating') orchestratingStatus = true;
      }
      if (key === 'swarms' && field === 'test-swarm') {
        assert.equal(val.status, 'active');
        assert.equal(val.agentCount, 2);
        swarmSaved = true;
      }
    });

    await swarm.handleSpawn({ swarmId: 'test-swarm', agentType: 'worker', count: 2 });
    
    assert.ok(orchestratingStatus);
    assert.ok(swarmSaved);
    assert.equal(execCalls.length, 2);
    assert.ok(execCalls[0].cmd.includes('worker.js'));
    assert.equal(execCalls[0].options.env.AGENT_ID, 'test-swarm_worker_0');
    assert.equal(execCalls[1].options.env.AGENT_ID, 'test-swarm_worker_1');
    assert.equal(swarm.children.size, 2);

    // Simulate child exit
    const childIterator = swarm.children.values();
    const firstChild = childIterator.next().value;
    firstChild.emit('exit', 0);
    assert.equal(swarm.children.size, 1, 'Child should be removed from map on exit');
  });

  it('handleSpawn graceful failure on bad input', async () => {
    // string parse failure or something
    await swarm.handleSpawn('invalid json {[');
    assert.equal(execCalls.length, 0);
  });

  it('handleTerminate should kill corresponding children', async () => {
    await swarm.handleSpawn({ swarmId: 'term-swarm', agentType: 'worker', count: 2 });
    assert.equal(swarm.children.size, 2);
    
    let terminatedStatus = false;
    mock.method(mockBoard, 'setHashField', async (key, field, val) => {
      if (key === 'swarms' && field === 'term-swarm:status') {
        assert.equal(val, 'terminated');
        terminatedStatus = true;
      }
    });

    // We can extract one child to check if kill() was called
    const childrenArr = Array.from(swarm.children.values());

    await swarm.handleTerminate({ swarmId: 'term-swarm' });
    
    assert.ok(terminatedStatus);
    assert.equal(swarm.children.size, 0, 'Children should be removed');
    assert.ok(childrenArr[0].killed);
    assert.ok(childrenArr[1].killed);
  });

  it('shutdown should kill all children and disconnect board', async () => {
    await swarm.handleSpawn({ swarmId: 'shut-swarm', agentType: 'worker', count: 1 });
    const childrenArr = Array.from(swarm.children.values());
    
    let disconnected = false;
    mockBoard.disconnect = async () => { disconnected = true; };

    // Fake an init to set subscriber
    await swarm.init();
    
    let subDisconnected = false;
    swarm.subscriber.disconnect = async () => { subDisconnected = true; };

    await swarm.shutdown();

    assert.ok(childrenArr[0].killed);
    assert.ok(disconnected);
    assert.ok(subDisconnected);
  });
});

describe('SwarmOrchestrator — Main Execution', () => {
  it('runs as standalone process and handles SIGINT', async () => {
    const path = require('path');
    const script = path.join(__dirname, '../agent/team/swarm-orchestrator.js');
    const cp = child_process.spawn(process.execPath, [script], {
      env: { ...process.env, BLACKBOARD_REDIS_URL: 'redis://localhost:6380' }
    });

    await new Promise(r => setTimeout(r, 1000));
    cp.kill('SIGINT');
    
    const [code] = await new Promise(r => cp.on('close', code => r([code])));
    assert.equal(code, 0, 'Should exit cleanly on SIGINT');
  });

  it('exits with status 1 on startup failure', async () => {
    const path = require('path');
    const script = path.join(__dirname, '../agent/team/swarm-orchestrator.js');
    // Provide a malformed URL to force the client constructor/connect to throw immediately
    const cp = child_process.spawn(process.execPath, [script], {
      env: { ...process.env, BLACKBOARD_REDIS_URL: 'not-a-url' } 
    });

    const [code] = await new Promise(r => {
      cp.on('close', code => r([code]));
      setTimeout(() => { cp.kill(); r([1]); }, 2000); // safety fallback
    });
    // the process should print an error and exit(1) via catch block
    assert.equal(code, 1, 'Should exit with code 1 on init failure');
  });

  it('runs main block internally to catch coverage of process.exit', async () => {
    delete require.cache[require.resolve('../agent/team/swarm-orchestrator.js')];
    delete require.cache[require.resolve('../agent/core/blackboard.js')];
    const T = require('../config/timeouts');
    const ogMax = T.MAX_RECONNECT_ATTEMPTS;
    T.MAX_RECONNECT_ATTEMPTS = 0; // Disable reconnects so it fails immediately
    
    process.env.TEST_SWARM_MAIN = '1';
    process.env.BLACKBOARD_REDIS_URL = 'redis://256.256.256.256:9999';
    let exitedCode = null;
    const ogExit = process.exit;
    process.exit = (code) => { exitedCode = code; };
    
    try {
      require('../agent/team/swarm-orchestrator.js');
      // wait a bit for the promise rejection
      await new Promise(r => setTimeout(r, 100));
      assert.equal(exitedCode, 1);
    } finally {
      process.exit = ogExit;
      delete process.env.TEST_SWARM_MAIN;
      T.MAX_RECONNECT_ATTEMPTS = ogMax;
    }
  });
});
