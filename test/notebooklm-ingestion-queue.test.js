const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const {
  ingestNotebookLMPackets,
  renderNotebookLMRegistry,
} = require('../scripts/run-notebooklm-ingestion-queue');

describe('NotebookLM Ingestion Queue', () => {
  it('ingests prepared notebooklm packets into a registry and publishes ingested events', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'notebooklm-ingested-'));
    const packetPath = path.join(tmpDir, 'kingdom--TASK-50.md');
    await fsp.writeFile(packetPath, '# NotebookLM Source Packet\n', 'utf-8');

    const published = [];
    const configs = new Map([
      ['knowledge:notebooklm:kingdom:TASK-50:queued', {
        author: 'codex',
        projectId: 'kingdom',
        taskId: 'TASK-50',
        queueType: 'promotion-source',
        sourcePath: '/tmp/completed-task-50.md',
        sourceTitle: 'Completed TASK-50',
        status: 'prepared',
        packetPath,
        preparedBy: 'notebooklm-packet-runner',
        preparedAt: '2026-03-05T14:00:00.000Z',
      }],
    ]);

    const board = {
      listConfigs: async (prefix) => {
        assert.equal(prefix, 'knowledge:notebooklm:');
        return [{
          key: 'knowledge:notebooklm:kingdom:TASK-50:queued',
          value: configs.get('knowledge:notebooklm:kingdom:TASK-50:queued'),
        }];
      },
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
    };

    const result = await ingestNotebookLMPackets({
      board,
      outputDir: tmpDir,
      author: 'codex',
    });

    assert.equal(result.ingestedCount, 1);
    assert.match(result.registryPath, /notebooklm-ingestion-registry\.md$/);
    assert.equal(configs.get('knowledge:notebooklm:kingdom:TASK-50:queued').status, 'ingested');
    assert.equal(configs.get('knowledge:notebooklm:kingdom:TASK-50:queued').ingestedBy, 'codex');
    assert.equal(published[0].channel, 'knowledge:notebooklm:ingested');
    assert.equal(published[0].data.taskId, 'TASK-50');

    const registry = await fsp.readFile(result.registryPath, 'utf-8');
    assert.match(registry, /# NotebookLM Ingestion Registry/);
    assert.match(registry, /Completed TASK-50/);
    assert.match(registry, /kingdom-grounded-sources/);
  });

  it('renders an empty registry when nothing is ingested', () => {
    const registry = renderNotebookLMRegistry([]);
    assert.match(registry, /# NotebookLM Ingestion Registry/);
    assert.match(registry, /No ingested NotebookLM sources/);
  });
});
