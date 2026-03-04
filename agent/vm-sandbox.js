/**
 * Shared vm sandbox validation for skill code.
 * Used by both SkillPipeline and SafetyAgent.
 */
const vm = require('node:vm');

const VM_TIMEOUT_MS = 3000;
const VM_VALIDATION_ATTEMPTS = 3;

async function validateCode(code, attempts = VM_VALIDATION_ATTEMPTS, timeoutMs = VM_TIMEOUT_MS) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const context = vm.createContext(Object.create(null));
      const script = new vm.Script(`(function() { ${code} })()`, {
        filename: 'sandbox-validation.js',
        timeout: timeoutMs,
      });
      script.runInContext(context, { timeout: timeoutMs });
    } catch (err) {
      return { valid: false, error: err.message, attempt: i };
    }
  }
  return { valid: true };
}

module.exports = { validateCode, VM_TIMEOUT_MS, VM_VALIDATION_ATTEMPTS };
