#!/usr/bin/env node
const { SkillEvaluator } = require('../agent/core/skill-evaluator');

async function main() {
  const evaluator = new SkillEvaluator();
  const arg = process.argv[2];

  const results = arg
    ? [await evaluator.evaluateSkill(arg)]
    : await evaluator.evaluateAll();

  const summary = {
    evaluated: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
