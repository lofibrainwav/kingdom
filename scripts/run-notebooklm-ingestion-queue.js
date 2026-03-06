const path = require('path');
const fsp = require('fs').promises;
const { Blackboard } = require('../agent/core/blackboard');

function renderNotebookLMRegistry(entries = []) {
  if (!entries.length) {
    return `# NotebookLM Ingestion Registry

No ingested NotebookLM sources.
`;
  }

  const lines = ['# NotebookLM Ingestion Registry', ''];
  for (const entry of entries) {
    lines.push(`## ${entry.projectId}/${entry.taskId}`);
    lines.push('');
    lines.push(`- Title: ${entry.sourceTitle || entry.taskId}`);
    lines.push(`- Suggested Notebook: ${entry.suggestedNotebook}`);
    lines.push(`- Queue Type: ${entry.queueType}`);
    lines.push(`- Packet Path: ${entry.packetPath}`);
    lines.push(`- Source Path: ${entry.sourcePath}`);
    lines.push(`- Ingested At: ${entry.ingestedAt || 'unknown'}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function ingestNotebookLMPackets({ board, outputDir, author = 'codex' } = {}) {
  if (!board?.listConfigs || !board?.setConfig || !board?.publish) {
    throw new Error('[NotebookLMIngestionQueue] board with listConfigs/setConfig/publish is required');
  }

  const entries = await board.listConfigs('knowledge:notebooklm:');
  const prepared = entries
    .map(({ key, value }) => ({ key, ...value }))
    .filter((entry) => entry.status === 'prepared')
    .sort((a, b) => {
      const aTime = Date.parse(a.preparedAt || 0);
      const bTime = Date.parse(b.preparedAt || 0);
      return aTime - bTime || a.key.localeCompare(b.key);
    });

  const ingestedAt = new Date().toISOString();
  const ingested = prepared.map((entry) => ({
    ...entry,
    suggestedNotebook: `${entry.projectId}-grounded-sources`,
    ingestedAt,
  }));

  const dir = outputDir || path.join(__dirname, '..', 'agent', 'vault', '05-Operations');
  await fsp.mkdir(dir, { recursive: true });
  const registryPath = path.join(dir, 'notebooklm-ingestion-registry.md');
  await fsp.writeFile(registryPath, renderNotebookLMRegistry(ingested), 'utf-8');

  for (const entry of ingested) {
    const updated = {
      ...entry,
      status: 'ingested',
      registryPath,
      ingestedBy: author,
    };
    await board.setConfig(entry.key, updated);
    await board.publish('knowledge:notebooklm:ingested', {
      author,
      projectId: entry.projectId,
      taskId: entry.taskId,
      registryPath,
      queueType: entry.queueType,
    });
  }

  return {
    ingestedCount: ingested.length,
    registryPath,
  };
}

async function main() {
  const board = new Blackboard();
  await board.connect();
  try {
    const result = await ingestNotebookLMPackets({
      board,
      author: 'notebooklm-ingestion-runner',
    });
    console.log(`Ingested ${result.ingestedCount} NotebookLM packets.`);
    console.log(result.registryPath);
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
  ingestNotebookLMPackets,
  renderNotebookLMRegistry,
};
