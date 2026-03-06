const path = require('path');
const fsp = require('fs').promises;
const { Blackboard } = require('../agent/core/blackboard');

function renderNotebookLMPacket(entry = {}) {
  return `# NotebookLM Source Packet

## Identity

- Project: ${entry.projectId}
- Task: ${entry.taskId}
- Title: ${entry.sourceTitle || entry.taskId}

## Source

- Queue Type: ${entry.queueType}
- Source Path: ${entry.sourcePath}
- Claimed By: ${entry.claimedBy || 'unknown'}
- Claimed At: ${entry.claimedAt || 'unknown'}

## Suggested Metadata

- Suggested Notebook: ${entry.projectId}-grounded-sources
- Source Type: promotion-source
- Tags: ${entry.projectId}, ${entry.queueType}, grounded-ingestion

## Operator Notes

- Review the source for grounded, citation-safe ingestion.
- Add this source to the matching NotebookLM library entry or ingestion workflow.
`;
}

async function prepareNotebookLMPackets({ board, outputDir, author = 'codex' } = {}) {
  if (!board?.listConfigs || !board?.setConfig || !board?.publish) {
    throw new Error('[NotebookLMPacketQueue] board with listConfigs/setConfig/publish is required');
  }

  const entries = await board.listConfigs('knowledge:notebooklm:');
  const claimed = entries
    .map(({ key, value }) => ({ key, ...value }))
    .filter((entry) => entry.status === 'claimed')
    .sort((a, b) => {
      const aTime = Date.parse(a.claimedAt || 0);
      const bTime = Date.parse(b.claimedAt || 0);
      return aTime - bTime || a.key.localeCompare(b.key);
    });

  const dir = outputDir || path.join(__dirname, '..', 'agent', 'vault', '05-Operations', 'notebooklm-packets');
  await fsp.mkdir(dir, { recursive: true });

  const preparedAt = new Date().toISOString();
  const packetPaths = [];

  for (const entry of claimed) {
    const packetFileName = `${entry.projectId}--${entry.taskId}.md`;
    const packetPath = path.join(dir, packetFileName);
    await fsp.writeFile(packetPath, renderNotebookLMPacket(entry), 'utf-8');
    packetPaths.push(packetPath);

    const updated = {
      ...entry,
      status: 'prepared',
      packetPath,
      preparedBy: author,
      preparedAt,
    };
    await board.setConfig(entry.key, updated);
    await board.publish('knowledge:notebooklm:prepared', {
      author,
      projectId: entry.projectId,
      taskId: entry.taskId,
      packetPath,
      queueType: entry.queueType,
    });
  }

  return {
    preparedCount: claimed.length,
    packetPaths,
  };
}

async function main() {
  const board = new Blackboard();
  await board.connect();
  try {
    const result = await prepareNotebookLMPackets({
      board,
      author: 'notebooklm-packet-runner',
    });
    console.log(`Prepared ${result.preparedCount} NotebookLM packets.`);
    for (const packetPath of result.packetPaths) {
      console.log(packetPath);
    }
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
  prepareNotebookLMPackets,
  renderNotebookLMPacket,
};
