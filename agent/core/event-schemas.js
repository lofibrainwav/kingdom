const SCHEMAS = {
  'work:intake': ['author', 'task'],
  'work:planning:init': ['projectId', 'goal', 'agentId'],
  'work:planning:designed': ['projectId', 'goal', 'architecture'],
  'work:planning:decomposed': ['projectId', 'goal', 'tasks'],
  'work:task:started': ['author', 'projectId', 'taskId', 'goal'],
  'execution:dispatch:*': ['author', 'action'],
  'execution:broadcast:*': ['author', 'action'],
  'execution:swarm:spawn': ['swarmId', 'agentType', 'count'],
  'execution:swarm:terminate': ['swarmId'],
  'execution:task:workspace-ready': ['author', 'projectId', 'taskId', 'workspacePath'],
  'execution:deployment:completed': ['projectId', 'status', 'timestamp'],
  'knowledge:skills:deployed': ['author', 'newSkill'],
  'knowledge:capture:stored': ['author', 'projectId', 'title', 'notePath', 'outcome'],
  'knowledge:skill:eval-completed': ['author', 'skillName', 'score', 'findingCount', 'passed'],
  'knowledge:rumination:digested': ['author', 'digestionNumber', 'experienceCount', 'insightCount', 'actionCount'],
  'knowledge:zettelkasten:tier-up': ['author', 'skill', 'oldTier', 'newTier', 'xp'],
  'knowledge:zettelkasten:compound-created': ['author', 'compound', 'sources'],
  'knowledge:got:completed': ['author', 'totalSynergies'],
  'governance:review:requested': ['projectId', 'taskId', 'file', 'content'],
  'governance:review:approved': ['projectId', 'taskId', 'file'],
  'governance:review:rejected': ['projectId', 'taskId', 'file', 'feedback'],
  'governance:failure:retry-requested': ['projectId', 'taskId', 'category', 'guardrail'],
  'governance:task:completed': ['author', 'projectId', 'taskId', 'verificationCount'],
  'governance:project:approved': ['projectId', 'goal'],
  'governance:watchdog:recovery': ['agentId', 'timestamp', 'action'],
  'governance:safety:threat': ['author'],
  'knowledge:reflexion:triggered': ['author'],
};

function getSchemaForChannel(channel) {
  if (!channel) return null;
  if (SCHEMAS[channel]) return SCHEMAS[channel];

  for (const [pattern, requiredFields] of Object.entries(SCHEMAS)) {
    if (!pattern.includes('*')) continue;
    const regex = new RegExp('^' + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '[^:]+') + '$');
    if (regex.test(channel)) return requiredFields;
  }

  return null;
}

function validateEventPayload(channel, data) {
  const requiredFields = getSchemaForChannel(channel);
  if (!requiredFields) return;

  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`[Blackboard] 眞: ${channel} requires field \"${field}\"`);
    }
  }
}

module.exports = {
  SCHEMAS,
  getSchemaForChannel,
  validateEventPayload,
};
