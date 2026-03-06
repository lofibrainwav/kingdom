const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const {
  prepareNotebookLMPackets,
  renderNotebookLMPacket,
} = require('../scripts/run-notebooklm-packet-queue');

describe('NotebookLM Packet Queue', () => {
  it('prepares claimed notebooklm entries into packet files and publishes prepared events', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'notebooklm-packets-'));
    const published = [];
    const configs = new Map([
      ['knowledge:notebooklm:kingdom:TASK-40:queued', {
        author: 'codex',
        projectId: 'kingdom',
        taskId: 'TASK-40',
        queueType: 'promotion-source',
        sourcePath: '/tmp/completed-task-40.md',
        sourceTitle: 'Completed TASK-40',
        status: 'claimed',
        claimedAt: '2026-03-05T13:00:00.000Z',
        claimedBy: 'notebooklm-promotion-runner',
      }],
    ]);

    const board = {
      listConfigs: async (prefix) => {
        assert.equal(prefix, 'knowledge:notebooklm:');
        return [{
          key: 'knowledge:notebooklm:kingdom:TASK-40:queued',
          value: configs.get('knowledge:notebooklm:kingdom:TASK-40:queued'),
        }];
      },
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
    };

    const result = await prepareNotebookLMPackets({
      board,
      outputDir: tmpDir,
      author: 'codex',
    });

    assert.equal(result.preparedCount, 1);
    assert.equal(result.packetPaths.length, 1);
    assert.match(result.packetPaths[0], /TASK-40\.md$/);
    assert.equal(configs.get('knowledge:notebooklm:kingdom:TASK-40:queued').status, 'prepared');
    assert.equal(configs.get('knowledge:notebooklm:kingdom:TASK-40:queued').preparedBy, 'codex');
    assert.equal(published[0].channel, 'knowledge:notebooklm:prepared');
    assert.equal(published[0].data.taskId, 'TASK-40');

    const packet = await fsp.readFile(result.packetPaths[0], 'utf-8');
    assert.match(packet, /# NotebookLM Source Packet/);
    assert.match(packet, /Completed TASK-40/);
    assert.match(packet, /promotion-source/);
  });

  it('renders a deterministic packet template', () => {
    const packet = renderNotebookLMPacket({
      projectId: 'kingdom',
      taskId: 'TASK-40',
      queueType: 'promotion-source',
      sourcePath: '/tmp/completed-task-40.md',
      sourceTitle: 'Completed TASK-40',
      claimedAt: '2026-03-05T13:00:00.000Z',
      claimedBy: 'notebooklm-promotion-runner',
    });

    assert.match(packet, /Project: kingdom/);
    assert.match(packet, /Task: TASK-40/);
    assert.match(packet, /Suggested Notebook: kingdom-grounded-sources/);
  });
});
