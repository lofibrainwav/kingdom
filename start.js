#!/usr/bin/env node
/**
 * Kingdom Full Stack Starter
 * Launches all services: team (agents) + MCP server
 * Usage: node start.js [--no-mcp]
 *
 * Dashboard is now Obsidian-native (ObsidianDashboard in team.js).
 * Standalone services are started in the same process.
 * Press Ctrl+C to stop everything gracefully.
 */
const { MCPOrchestrator } = require('./agent/interface/mcp-orchestrator');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const noMCP = args.includes('--no-mcp');

async function main() {
  console.log('');
  console.log('🚀 Kingdom Full Stack Starting');
  console.log('═══════════════════════════════════════');

  const services = [];

  // Start MCP Orchestrator (Redis-based agent registry)
  if (!noMCP) {
    const mcp = new MCPOrchestrator();
    await mcp.init();
    services.push({ name: 'MCP', instance: mcp, stop: () => mcp.shutdown() });
    console.log('  ✅ MCP Orchestrator: initialized');
  }

  // Start team.js as child process (it manages its own Redis + bots)
  const team = spawn('node', ['agent/team.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env },
  });

  console.log('  ✅ Team:       spawning agents...');
  console.log('═══════════════════════════════════════');
  console.log('');

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 Stopping all services (${signal})...`);

    // Kill team process
    team.kill('SIGINT');

    // Stop standalone services
    for (const svc of services) {
      try {
        await svc.stop();
        console.log(`  ✅ ${svc.name} stopped`);
      } catch (err) {
        console.error(`  ❌ ${svc.name} stop error: ${err.message}`);
      }
    }

    // Wait for team to exit, then force after 5s
    const forceTimeout = setTimeout(() => {
      console.log('  ⚠️  Force killing team process');
      team.kill('SIGKILL');
      process.exit(1);
    }, 5000);

    team.on('exit', () => {
      clearTimeout(forceTimeout);
      console.log('  ✅ Team stopped');
      console.log('🏁 All services stopped.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  team.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[Team] exited with code ${code}`);
      shutdown('team-exit');
    }
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
