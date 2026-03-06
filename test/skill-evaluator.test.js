const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { SkillEvaluator } = require('../agent/core/skill-evaluator');

describe('SkillEvaluator', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'skill-evaluator-'));
  });

  it('scores a well-formed skill and parses frontmatter', async () => {
    const skillDir = path.join(tmpDir, 'good-skill');
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: good-skill
description: Use when evaluating skill quality in Kingdom
---

# Good Skill

## When to Use
- When a skill needs structural validation

## Implementation
Run the evaluator and inspect findings.
`, 'utf-8');

    const evaluator = new SkillEvaluator({ skillsRoot: tmpDir });
    const result = await evaluator.evaluateSkill('good-skill');

    assert.equal(result.passed, true);
    assert.equal(result.score, 100);
    assert.equal(result.frontmatter.name, 'good-skill');
    assert.equal(result.findings.length, 0);
  });

  it('reports structural findings for weak skills', async () => {
    const skillDir = path.join(tmpDir, 'weak-skill');
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: weak-skill
description: Skill quality evaluation
---

# Weak Skill
`, 'utf-8');

    const evaluator = new SkillEvaluator({ skillsRoot: tmpDir });
    const result = await evaluator.evaluateSkill('weak-skill');

    assert.equal(result.passed, false);
    assert.ok(result.score < 100);
    assert.match(result.findings.join('\n'), /Use when/);
    assert.match(result.findings.join('\n'), /When to Use/);
  });

  it('evaluates all skills and marks missing SKILL files as failures', async () => {
    await fsp.mkdir(path.join(tmpDir, 'missing-skill'), { recursive: true });
    const validDir = path.join(tmpDir, 'valid-skill');
    await fsp.mkdir(validDir, { recursive: true });
    await fsp.writeFile(path.join(validDir, 'SKILL.md'), `---
name: valid-skill
description: Use when checking multiple skills at once
---

# Valid Skill

## When to Use
- During bulk evaluation

## References
- None
`, 'utf-8');

    const evaluator = new SkillEvaluator({ skillsRoot: tmpDir });
    const results = await evaluator.evaluateAll();

    assert.equal(results.length, 2);
    assert.equal(results.find((result) => result.skillName === 'valid-skill').passed, true);
    assert.equal(results.find((result) => result.skillName === 'missing-skill').passed, false);
  });

  it('publishes evaluation results when a board is provided', async () => {
    const skillDir = path.join(tmpDir, 'published-skill');
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: published-skill
description: Use when publishing skill eval results
---

# Published Skill

## When to Use
- During quality evaluation

## Implementation
- Publish the result
`, 'utf-8');

    const published = [];
    const evaluator = new SkillEvaluator({
      skillsRoot: tmpDir,
      board: {
        publish: async (channel, data) => {
          published.push({ channel, data });
        },
      },
    });

    const result = await evaluator.evaluateSkill('published-skill');

    assert.equal(result.passed, true);
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'knowledge:skill:eval-completed');
    assert.equal(published[0].data.skillName, 'published-skill');
  });

  it('allows non-critical advisory findings while still passing strong skills', async () => {
    const skillDir = path.join(tmpDir, 'advisory-skill');
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: advisory-skill
description: Helpful skill for evaluation
---

# Advisory Skill

## Use This Skill When
- Structural checks are enough for a first pass

## Workflow
- Run the evaluator
`, 'utf-8');

    const evaluator = new SkillEvaluator({ skillsRoot: tmpDir });
    const result = await evaluator.evaluateSkill('advisory-skill');

    assert.equal(result.passed, true);
    assert.ok(result.findings.includes('description should start with "Use when"'));
    assert.equal(result.score, 90);
  });
});
