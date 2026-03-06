const path = require('path');
const fsp = require('fs').promises;
const { Blackboard } = require('../agent/core/blackboard');

function renderNotebookLMPromotionManifest(entries = []) {
  if (!entries.length) {
    return `# NotebookLM Promotion Queue

No queued NotebookLM promotions.
`;
  }

  const lines = ['# NotebookLM Promotion Queue', ''];
  for (const entry of entries) {
    lines.push(`## ${entry.projectId}/${entry.taskId}`);
    lines.push('');
    lines.push(`- Title: ${entry.sourceTitle || entry.taskId}`);
    lines.push(`- Queue Type: ${entry.queueType}`);
    lines.push(`- Source Path: ${entry.sourcePath}`);
    lines.push(`- Queued At: ${entry.queuedAt || 'unknown'}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function claimNotebookLMPromotionQueue({ board, outputDir, author = 'codex' } = {}) {
  if (!board?.listConfigs || !board?.setConfig || !board?.publish) {
    throw new Error('[NotebookLMPromotionQueue] board with listConfigs/setConfig/publish is required');
  }

  const entries = await board.listConfigs('knowledge:notebooklm:');
  const queued = entries
    .map(({ key, value }) => ({ key, ...value }))
    .filter((entry) => entry.status === 'queued')
    .sort((a, b) => {
      const aTime = Date.parse(a.queuedAt || 0);
      const bTime = Date.parse(b.queuedAt || 0);
      return aTime - bTime || a.key.localeCompare(b.key);
    });

  const claimedAt = new Date().toISOString();
  for (const entry of queued) {
    const updated = {
      ...entry,
      status: 'claimed',
      claimedBy: author,
      claimedAt,
    };
    await board.setConfig(entry.key, updated);
    await board.publish('knowledge:notebooklm:claimed', {
      author,
      projectId: entry.projectId,
      taskId: entry.taskId,
      sourcePath: entry.sourcePath,
      queueType: entry.queueType,
    });
  }

  const manifest = renderNotebookLMPromotionManifest(queued);
  const dir = outputDir || path.join(__dirname, '..', 'agent', 'vault', '05-Operations');
  await fsp.mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'notebooklm-promotion-queue.md');
  await fsp.writeFile(manifestPath, manifest, 'utf-8');

  return {
    claimedCount: queued.length,
    manifestPath,
  };
}

async function main() {
  const board = new Blackboard();
  await board.connect();
  try {
    const result = await claimNotebookLMPromotionQueue({
      board,
      author: 'notebooklm-promotion-runner',
    });
    console.log(`Claimed ${result.claimedCount} NotebookLM promotions.`);
    console.log(result.manifestPath);
  } finally {
    await board.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  claimNotebookLMPromotionQueue,
  renderNotebookLMPromotionManifest,
};
