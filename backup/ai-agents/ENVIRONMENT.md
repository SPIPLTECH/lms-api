# Environment Variables

| Variable | Purpose | Used by | Required/Optional | Example format |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | **Shared across 3 places — do not remove even after this removal**: (1) Mentor Agent's dormant `llm/anthropicProvider.js` (model `claude-sonnet-4-5`), (2) Assessment Agent's `llm/anthropicProvider.js` (Entry Phase question generation), (3) the unrelated, non-agent `src/modules/course-import` LLM provider (kept, not part of this removal). Optional for all three — each has a documented honest fallback when absent. | Optional | `<ANTHROPIC_API_KEY>` |

No other environment variable was found scoped to any of the 12 agents. Every scheduler's cron expression (`DAILY_SWEEP_CRON`, `CRON_EXPRESSION`, `WEEKLY_REPORT_CRON`, etc.) is a hardcoded constant inside each agent's own `constants/thresholds.constants.js` or equivalent, not read from `process.env` — see `CONFIGURATION.md` for the full cron table.

## Confirmed NOT agent-specific (shared/core — never touch)
`DATABASE_URL`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_EXPIRE`, `REFRESH_TOKEN_EXPIRE`, `FRONTEND_URL`, `BREVO_API_KEY`/`HOST`/`PORT`/`USER`/`PASS`, `MAIL_FROM`, `RAZORPAY_KEY_ID`/`KEY_SECRET`/`WEBHOOK_SECRET`, `NODE_ENV`.

## Related but explicitly out of scope (belongs to separate, non-agent-list backend modules — do not restore as part of the 12 agents)
`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, `OLLAMA_THINK_TIMEOUT_MS`, `OLLAMA_MAX_OUTPUT_TOKENS` (read in `src/modules/llm/llm.config.js` — this is the shared platform LLM service the LIVE Mentor path actually uses, see ARCHITECTURE.md; it is not itself one of the 12 agents and was not removed). `BKT_DEFAULT_P_L0`/`P_T`/`P_G`/`P_S` (in `src/modules/learner-model/bkt.config.js` — also not one of the 12 agents).

## Restoration note
No actual secret values are recorded anywhere in this backup — only the variable name and its purpose, per Rule 5. Restoring the agents requires the operator to supply a real `ANTHROPIC_API_KEY` (or accept the documented fallback behavior in both Mentor's dormant path and Assessment's Entry Phase question generation) — it does not need to be newly provisioned if it's already set for course-import, since it's the same variable.
