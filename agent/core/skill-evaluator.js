const fsp = require('fs').promises;
const path = require('path');

const DEFAULT_SKILLS_ROOT = path.join(__dirname, '..', '..', '.claude', 'skills');

class SkillEvaluator {
  constructor(options = {}) {
    this.skillsRoot = options.skillsRoot || DEFAULT_SKILLS_ROOT;
    this.board = options.board || null;
  }

  async evaluateSkill(skillName) {
    const skillPath = path.join(this.skillsRoot, skillName, 'SKILL.md');
    let content;
    try {
      content = await fsp.readFile(skillPath, 'utf-8');
    } catch {
      return { skillName, skillPath, score: 0, findings: ['missing SKILL.md'], lineCount: 0, frontmatter: {}, passed: false };
    }
    const lines = content.split('\n');
    const frontmatter = this._parseFrontmatter(content);
    const findings = [];
    const criticalFindings = [];
    let score = 100;

    if (!frontmatter.name) {
      findings.push('missing frontmatter.name');
      criticalFindings.push('missing frontmatter.name');
      score -= 25;
    }

    if (!frontmatter.description) {
      findings.push('missing frontmatter.description');
      criticalFindings.push('missing frontmatter.description');
      score -= 25;
    }

    if (frontmatter.description && !/^Use when\b/i.test(frontmatter.description.trim())) {
      findings.push('description should start with "Use when"');
      score -= 10;
    }

    if (lines.length > 500) {
      findings.push(`SKILL.md exceeds 500 lines (${lines.length})`);
      score -= 15;
    }

    if (!/^##\s+When to Use\b/m.test(content) &&
        !/^##\s+When To Use\b/m.test(content) &&
        !/^##\s+Use This Skill When\b/m.test(content)) {
      findings.push('missing "When to Use" section');
      score -= 10;
    }

    if (!/^##\s+(References|Reference|Implementation|Workflow)\b/m.test(content)) {
      findings.push('missing reference or implementation section');
      score -= 5;
    }

    const normalizedScore = Math.max(0, score);
    const result = {
      skillName,
      skillPath,
      score: normalizedScore,
      findings,
      lineCount: lines.length,
      frontmatter,
      passed: criticalFindings.length === 0 && normalizedScore >= 80,
    };

    if (this.board) {
      await this.board.publish('knowledge:skill:eval-completed', {
        author: 'skill-evaluator',
        skillName,
        score: result.score,
        findingCount: findings.length,
        passed: result.passed,
      });
    }

    return result;
  }

  async evaluateAll() {
    const entries = await fsp.readdir(this.skillsRoot, { withFileTypes: true });
    const skills = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const results = [];
    for (const skillName of skills) {
      results.push(await this.evaluateSkill(skillName));
    }

    return results;
  }

  _parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    return match[1]
      .split('\n')
      .reduce((acc, line) => {
        const idx = line.indexOf(':');
        if (idx === -1) return acc;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        acc[key] = value;
        return acc;
      }, {});
  }
}

module.exports = {
  SkillEvaluator,
  DEFAULT_SKILLS_ROOT,
};
