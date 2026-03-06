/**
 * Centralized Timeout Configuration
 *
 * All timing constants used across agent/*.js.
 * Override via environment variables where supported.
 * Values are in milliseconds unless noted otherwise.
 */

module.exports = {
  // -- Reconnection --

  /** Base delay for exponential backoff on reconnect */
  BASE_RECONNECT_DELAY_MS: 1000,

  /** Max reconnect attempts before giving up */
  MAX_RECONNECT_ATTEMPTS: 10,

  // -- VM Sandbox --

  /** node:vm script execution timeout */
  VM_TIMEOUT_MS: parseInt(process.env.VM_TIMEOUT_MS) || 3000,

  // -- Learning Engines --

  /** Rumination digestion cycle interval (5 min) */
  RUMINATION_INTERVAL_MS: 5 * 60 * 1000,

  /** Deep rumination schedule (30 min) */
  DEEP_RUMINATION_INTERVAL_MS: 30 * 60 * 1000,

  // -- Redis (Blackboard) --

  /** Max backoff for Redis reconnect strategy */
  REDIS_RECONNECT_MAX_MS: 3000,

  /** TTL for latest status keys (seconds, not ms) */
  REDIS_KEY_EXPIRY_SECONDS: 300,

  // -- Skill System --

  /** Daily skill reset interval (24h) */
  SKILL_DAILY_RESET_MS: 24 * 60 * 60 * 1000,

  // -- Remote Control --

  /** RC command response timeout */
  RC_RESPONSE_TIMEOUT_MS: 30000,

  // -- Watchdog --

  /** Health check poll interval */
  WATCHDOG_CHECK_INTERVAL_MS: 30000,

  /** Time before agent marked unresponsive */
  WATCHDOG_UNRESPONSIVE_THRESHOLD_MS: 60000,

  // -- Team Lifecycle --

  /** Per-agent graceful shutdown timeout */
  TEAM_SHUTDOWN_TIMEOUT_MS: 5000,

  // -- Discord --

  /** ReAct pulse throttle window */
  DISCORD_REACT_THROTTLE_MS: 30000,

  /** Max reconnect backoff delay for Discord */
  DISCORD_RECONNECT_CAP_MS: 30000,

  // -- LLM --

  /** LM Studio availability pre-check timeout */
  LM_STUDIO_PRECHECK_TIMEOUT_MS: 2000,

  /** LM Studio inference request timeout */
  LM_STUDIO_REQUEST_TIMEOUT_MS: 120000,

  /** Default max tokens for LLM responses */
  LLM_MAX_TOKENS: 1024,

  // -- Blackboard --

  /** Max publish payload size (bytes) */
  BLACKBOARD_PAYLOAD_LIMIT_BYTES: 10240,
};
