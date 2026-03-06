const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const {
  claimNotebookLMPromotionQueue,
  renderNotebookLMPromotionManifest,
} = require('../scripts/run-notebooklm-promotion-queue');

describe('NotebookLM Promotion Queue', () => {
  it('claims queued notebooklm promotions and writes a manifest', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'notebooklm-promotion-'));
    const published = [];
    const configs = new Map([
      ['knowledge:notebooklm:kingdom:TASK-31:queued', {
        author: 'codex',
        projectId: 'kingdom',
        taskId: 'TASK-31',
        queueType: 'promotion-source',
        sourcePath: '/tmp/completed-task-31.md',
        sourceTitle: 'Completed TASK-31',
        status: 'queued',
        queuedAt: '2026-03-05T12:00:00.000Z',
      }],
    ]);

    const board = {
      listConfigs: async (prefix) => {
        assert.equal(prefix, 'knowledge:notebooklm:');
        return [
          {
            key: 'knowledge:notebooklm:kingdom:TASK-31:queued',
            value: configs.get('knowledge:notebooklm:kingdom:TASK-31:queued'),
          },
        ];
      },
      setConfig: async (key, value) => {
        configs.set(key, value);
      },
      publish: async (channel, data) => {
        published.push({ channel, data });
      },
    };

    const result = await claimNotebookLMPromotionQueue({
      board,
      outputDir: tmpDir,
      author: 'codex',
    });

    assert.equal(result.claimedCount, 1);
    assert.match(result.manifestPath, /notebooklm-promotion-queue\.md$/);
    assert.equal(configs.get('knowledge:notebooklm:kingdom:TASK-31:queued').status, 'claimed');
    assert.equal(configs.get('knowledge:notebooklm:kingdom:TASK-31:queued').claimedBy, 'codex');
    assert.equal(published[0].channel, 'knowledge:notebooklm:claimed');
    assert.equal(published[0].data.taskId, 'TASK-31');

    const manifest = await fsp.readFile(result.manifestPath, 'utf-8');
    assert.match(manifest, /# NotebookLM Promotion Queue/);
    assert.match(manifest, /Completed TASK-31/);
    assert.match(manifest, /promotion-source/);
  });

  it('renders an empty manifest when no queued promotions exist', () => {
    const manifest = renderNotebookLMPromotionManifest([]);
    assert.match(manifest, /# NotebookLM Promotion Queue/);
    assert.match(manifest, /No queued NotebookLM promotions/);
  });
});
