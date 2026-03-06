const { KnowledgeOperator } = require('../agent/memory/knowledge-operator');

async function main() {
  const operator = new KnowledgeOperator();
  await operator.init();
  await operator.start();

  process.on('SIGINT', async () => {
    await operator.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await operator.shutdown();
    process.exit(0);
  });

  console.log('Knowledge operator is running and listening for governance events.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
