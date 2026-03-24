/**
 * Generate a realistic golden trace representing an AI coding assistant session.
 *
 * Scenario: An agent is asked to "add input validation to the user registration endpoint".
 * The session includes multi-turn LLM conversations, file reads, file writes, shell commands,
 * a secret accidentally appearing in output (redactable), a policy decision event,
 * guard observations, and realistic payload sizes.
 *
 * Uses Krynix's actual hash chain computation to produce a valid trace.
 */
import { computeHashChain, SCHEMA_VERSION, canonicalize } from "../packages/core/src/index.js";
import type { TraceEvent } from "../packages/core/src/index.js";

const SESSION_ID = "a1b2c3d4-5e6f-7890-abcd-ef1234567890";
const AGENT_ID = "claude-code-v4";
const BASE_TIME = new Date("2026-03-15T09:30:00.000Z");

function ts(offsetSeconds: number) {
  return new Date(BASE_TIME.getTime() + offsetSeconds * 1000).toISOString();
}

let eventCounter = 0;
function eventId() {
  const id = `evt-${String(eventCounter).padStart(4, "0")}-${SESSION_ID.slice(0, 8)}`;
  eventCounter++;
  return id;
}

// Build events WITHOUT hash chain (computeHashChain fills prev_hash + event_hash)
const rawEvents = [
  // 0: session_start
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 0,
    timestamp: ts(0), event_type: "lifecycle", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      action: "session_start",
      context: {
        agent_version: "4.6.0",
        replay_seed: 98765,
        workspace: "/home/dev/projects/myapp",
        repository: "github.com/acme/myapp",
        branch: "feat/user-validation",
        commit_sha: "a3f8e21c",
        environment: "development",
        profile: "dev"
      }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "intent.source": "user_prompt", "guard.session_policy": "default-dev" },
    schema_version: SCHEMA_VERSION
  },

  // 1: observation — user request captured
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 1,
    timestamp: ts(1), event_type: "observation", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      source: "user_input",
      content: "Add input validation to the user registration endpoint in src/routes/auth.ts. Validate email format, password strength (min 8 chars, 1 uppercase, 1 number), and username uniqueness."
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "intent.risk_score": 0.12, "intent.risk_labels": ["code_modification"], "guard.input_check": "pass" },
    schema_version: SCHEMA_VERSION
  },

  // 2: llm_request — initial planning
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 2,
    timestamp: ts(2), event_type: "llm_request", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      model: "claude-sonnet-4-6-20260315",
      messages: [
        { role: "system", content: "You are a coding assistant. You help users modify their codebase safely." },
        { role: "user", content: "Add input validation to the user registration endpoint in src/routes/auth.ts. Validate email format, password strength (min 8 chars, 1 uppercase, 1 number), and username uniqueness." }
      ],
      parameters: { max_tokens: 4096, temperature: 0.3, top_p: 0.95 }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 3: llm_response — plan
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 3,
    timestamp: ts(5), event_type: "llm_response", parent_id: "evt-0002-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      model: "claude-sonnet-4-6-20260315",
      content: "I'll add input validation to the registration endpoint. Let me first read the current implementation to understand the existing code structure, then I'll add validation logic.\n\nPlan:\n1. Read `src/routes/auth.ts` to see the current registration handler\n2. Read `src/models/user.ts` to understand the User model\n3. Create a validation utility in `src/utils/validation.ts`\n4. Update the registration handler to use validation\n5. Run tests to verify",
      usage: { prompt_tokens: 847, completion_tokens: 312 },
      finish_reason: "stop"
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 4: tool_call — read auth.ts
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 4,
    timestamp: ts(6), event_type: "tool_call", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_read",
      arguments: {
        path: "src/routes/auth.ts",
        encoding: "utf-8"
      }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.path_check": "allow", "runtime.tool_category": "file_read" },
    schema_version: SCHEMA_VERSION
  },

  // 5: tool_result — auth.ts content
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 5,
    timestamp: ts(7), event_type: "tool_result", parent_id: "evt-0004-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_read",
      output: "import express from 'express';\nimport { User } from '../models/user';\nimport { hashPassword } from '../utils/crypto';\nimport { db } from '../db';\n\nconst router = express.Router();\n\nrouter.post('/register', async (req, res) => {\n  try {\n    const { email, password, username } = req.body;\n    \n    const hashedPassword = await hashPassword(password);\n    const user = await User.create({\n      email,\n      password: hashedPassword,\n      username,\n    });\n    \n    res.status(201).json({ id: user.id, email: user.email, username: user.username });\n  } catch (error) {\n    if (error.code === '23505') {\n      res.status(409).json({ error: 'Email or username already exists' });\n    } else {\n      res.status(500).json({ error: 'Internal server error' });\n    }\n  }\n});\n\nexport default router;\n",
      duration_ms: 12
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "runtime.bytes_read": 742 },
    schema_version: SCHEMA_VERSION
  },

  // 6: tool_call — read user model
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 6,
    timestamp: ts(8), event_type: "tool_call", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_read",
      arguments: { path: "src/models/user.ts" }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.path_check": "allow" },
    schema_version: SCHEMA_VERSION
  },

  // 7: tool_result — user model content
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 7,
    timestamp: ts(9), event_type: "tool_result", parent_id: "evt-0006-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_read",
      output: "import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';\n\n@Entity('users')\n@Unique(['email'])\n@Unique(['username'])\nexport class User {\n  @PrimaryGeneratedColumn('uuid')\n  id: string;\n\n  @Column({ type: 'varchar', length: 255 })\n  email: string;\n\n  @Column({ type: 'varchar', length: 255 })\n  password: string;\n\n  @Column({ type: 'varchar', length: 50 })\n  username: string;\n\n  @CreateDateColumn()\n  created_at: Date;\n}\n",
      duration_ms: 8
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 8: llm_request — generate validation code
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 8,
    timestamp: ts(10), event_type: "llm_request", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      model: "claude-sonnet-4-6-20260315",
      messages: [
        { role: "system", content: "You are a coding assistant." },
        { role: "user", content: "Add input validation to the user registration endpoint..." },
        { role: "assistant", content: "I'll add input validation..." },
        { role: "user", content: "[file contents of auth.ts and user.ts shown above]" },
        { role: "assistant", content: "Now I understand the structure. Let me create the validation utility." }
      ],
      parameters: { max_tokens: 4096, temperature: 0.3 }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 9: llm_response — validation code
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 9,
    timestamp: ts(14), event_type: "llm_response", parent_id: "evt-0008-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      model: "claude-sonnet-4-6-20260315",
      content: "I'll create the validation utility and update the registration handler.\n\n```typescript\n// src/utils/validation.ts\nexport interface ValidationError {\n  field: string;\n  message: string;\n}\n\nexport function validateEmail(email: string): ValidationError | null {\n  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  if (!email || !emailRegex.test(email)) {\n    return { field: 'email', message: 'Invalid email format' };\n  }\n  return null;\n}\n\nexport function validatePassword(password: string): ValidationError | null {\n  if (!password || password.length < 8) {\n    return { field: 'password', message: 'Password must be at least 8 characters' };\n  }\n  if (!/[A-Z]/.test(password)) {\n    return { field: 'password', message: 'Password must contain at least one uppercase letter' };\n  }\n  if (!/[0-9]/.test(password)) {\n    return { field: 'password', message: 'Password must contain at least one number' };\n  }\n  return null;\n}\n\nexport function validateUsername(username: string): ValidationError | null {\n  if (!username || username.length < 3 || username.length > 50) {\n    return { field: 'username', message: 'Username must be 3-50 characters' };\n  }\n  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {\n    return { field: 'username', message: 'Username can only contain letters, numbers, hyphens, and underscores' };\n  }\n  return null;\n}\n```",
      usage: { prompt_tokens: 1893, completion_tokens: 687 },
      finish_reason: "stop"
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 10: tool_call — write validation.ts
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 10,
    timestamp: ts(15), event_type: "tool_call", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_write",
      arguments: {
        path: "src/utils/validation.ts",
        content: "export interface ValidationError {\n  field: string;\n  message: string;\n}\n\nexport function validateEmail(email: string): ValidationError | null {\n  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  if (!email || !emailRegex.test(email)) {\n    return { field: 'email', message: 'Invalid email format' };\n  }\n  return null;\n}\n\nexport function validatePassword(password: string): ValidationError | null {\n  if (!password || password.length < 8) {\n    return { field: 'password', message: 'Password must be at least 8 characters' };\n  }\n  if (!/[A-Z]/.test(password)) {\n    return { field: 'password', message: 'Password must contain at least one uppercase letter' };\n  }\n  if (!/[0-9]/.test(password)) {\n    return { field: 'password', message: 'Password must contain at least one number' };\n  }\n  return null;\n}\n\nexport function validateUsername(username: string): ValidationError | null {\n  if (!username || username.length < 3 || username.length > 50) {\n    return { field: 'username', message: 'Username must be 3-50 characters' };\n  }\n  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {\n    return { field: 'username', message: 'Username can only contain letters, numbers, hyphens, and underscores' };\n  }\n  return null;\n}\n"
      },
      approval_status: "auto"
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.path_check": "allow", "guard.rule_id": "PG-001", "runtime.tool_category": "file_write" },
    schema_version: SCHEMA_VERSION
  },

  // 11: tool_result — write success
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 11,
    timestamp: ts(16), event_type: "tool_result", parent_id: "evt-0010-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: { tool_name: "file_write", output: "Created src/utils/validation.ts (847 bytes)", duration_ms: 23 },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "runtime.bytes_written": 847 },
    schema_version: SCHEMA_VERSION
  },

  // 12: tool_call — write updated auth.ts
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 12,
    timestamp: ts(17), event_type: "tool_call", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_write",
      arguments: {
        path: "src/routes/auth.ts",
        content: "import express from 'express';\nimport { User } from '../models/user';\nimport { hashPassword } from '../utils/crypto';\nimport { db } from '../db';\nimport { validateEmail, validatePassword, validateUsername } from '../utils/validation';\n\nconst router = express.Router();\n\nrouter.post('/register', async (req, res) => {\n  try {\n    const { email, password, username } = req.body;\n\n    // Input validation\n    const errors = [\n      validateEmail(email),\n      validatePassword(password),\n      validateUsername(username),\n    ].filter(Boolean);\n\n    if (errors.length > 0) {\n      return res.status(400).json({ errors });\n    }\n\n    // Check username uniqueness (email uniqueness handled by DB constraint)\n    const existingUser = await db.query('SELECT id FROM users WHERE username = $1', [username]);\n    if (existingUser.rows.length > 0) {\n      return res.status(409).json({ error: 'Username already taken' });\n    }\n\n    const hashedPassword = await hashPassword(password);\n    const user = await User.create({\n      email,\n      password: hashedPassword,\n      username,\n    });\n\n    res.status(201).json({ id: user.id, email: user.email, username: user.username });\n  } catch (error) {\n    if (error.code === '23505') {\n      res.status(409).json({ error: 'Email or username already exists' });\n    } else {\n      res.status(500).json({ error: 'Internal server error' });\n    }\n  }\n});\n\nexport default router;\n"
      },
      approval_status: "auto"
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.path_check": "allow", "guard.rule_id": "PG-001" },
    schema_version: SCHEMA_VERSION
  },

  // 13: tool_result — auth.ts write success
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 13,
    timestamp: ts(18), event_type: "tool_result", parent_id: "evt-0012-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: { tool_name: "file_write", output: "Updated src/routes/auth.ts (1134 bytes)", duration_ms: 19 },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "runtime.bytes_written": 1134 },
    schema_version: SCHEMA_VERSION
  },

  // 14: tool_call — run tests
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 14,
    timestamp: ts(19), event_type: "tool_call", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      tool_name: "shell_exec",
      arguments: {
        command: "npm test -- --grep 'registration'",
        working_directory: "/home/dev/projects/myapp",
        timeout_ms: 30000
      },
      approval_status: "auto"
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.command_check": "allow", "guard.rule_id": "CG-002", "runtime.tool_category": "shell" },
    schema_version: SCHEMA_VERSION
  },

  // 15: tool_result — test output
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 15,
    timestamp: ts(28), event_type: "tool_result", parent_id: "evt-0014-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      tool_name: "shell_exec",
      output: "PASS src/routes/__tests__/auth.test.ts\n  Registration endpoint\n    ✓ should register a new user with valid input (45ms)\n    ✓ should reject duplicate email (23ms)\n    ✓ should reject invalid email format (8ms)\n    ✓ should reject weak password - too short (6ms)\n    ✓ should reject weak password - no uppercase (5ms)\n    ✓ should reject weak password - no number (5ms)\n    ✓ should reject invalid username characters (4ms)\n    ✓ should reject username too short (4ms)\n\nTest Suites: 1 passed, 1 total\nTests:       8 passed, 8 total\nTime:        2.847s",
      exit_code: 0,
      duration_ms: 8934
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "runtime.exit_code": 0, "runtime.test_passed": 8, "runtime.test_failed": 0 },
    schema_version: SCHEMA_VERSION
  },

  // 16: decision — agent decides to check for env vars leakage
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 16,
    timestamp: ts(29), event_type: "decision", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      action: "security_review",
      reasoning: "Before completing the task, verify that the database connection string and any secrets in the test configuration are not hardcoded. Check .env file exists and is gitignored.",
      confidence: 0.92
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 17: tool_call — read .env (contains a secret that should be redacted)
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 17,
    timestamp: ts(30), event_type: "tool_call", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_read",
      arguments: { path: ".env" }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.path_check": "warn", "guard.rule_id": "PG-005", "guard.message": "Reading .env file — secrets may be present" },
    schema_version: SCHEMA_VERSION
  },

  // 18: tool_result — .env content with secret (this would be redacted in a real trace)
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 18,
    timestamp: ts(31), event_type: "tool_result", parent_id: "evt-0017-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      tool_name: "file_read",
      output: {
        DATABASE_URL: "postgres://myapp:[REDACTED:d4b7e012]@localhost:5432/myapp_dev",
        SESSION_SECRET: "[REDACTED:a8f3e21c]",
        API_KEY: "[REDACTED:7b2d9f01]",
        NODE_ENV: "development",
        PORT: "3000",
        JWT_TOKEN: "[REDACTED:c4e8b5a2]"
      },
      duration_ms: 5
    },
    redacted: true, prev_hash: "", event_hash: "",
    metadata: { "runtime.redacted_fields": ["DATABASE_URL", "SESSION_SECRET", "API_KEY", "JWT_TOKEN"] },
    schema_version: SCHEMA_VERSION
  },

  // 19: observation — guard observation about .gitignore
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 19,
    timestamp: ts(32), event_type: "observation", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      source: "file_system_check",
      content: {
        check: ".env listed in .gitignore",
        result: true,
        gitignore_path: ".gitignore",
        matching_pattern: ".env"
      }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.security_check": "pass" },
    schema_version: SCHEMA_VERSION
  },

  // 20: tool_call — shell: git diff to verify changes
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 20,
    timestamp: ts(33), event_type: "tool_call", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      tool_name: "shell_exec",
      arguments: {
        command: "git diff --stat",
        working_directory: "/home/dev/projects/myapp"
      }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "guard.command_check": "allow" },
    schema_version: SCHEMA_VERSION
  },

  // 21: tool_result — git diff output
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 21,
    timestamp: ts(34), event_type: "tool_result", parent_id: "evt-0020-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      tool_name: "shell_exec",
      output: " src/routes/auth.ts        | 18 +++++++++++++-----\n src/utils/validation.ts   | 42 ++++++++++++++++++++++++++++++++++++++++++\n 2 files changed, 55 insertions(+), 5 deletions(-)\n",
      exit_code: 0,
      duration_ms: 156
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 22: llm_request — summary
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 22,
    timestamp: ts(35), event_type: "llm_request", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      model: "claude-sonnet-4-6-20260315",
      messages: [
        { role: "system", content: "You are a coding assistant." },
        { role: "user", content: "Summarize what you did." }
      ],
      parameters: { max_tokens: 2048, temperature: 0.3 }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  },

  // 23: llm_response — summary
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 23,
    timestamp: ts(38), event_type: "llm_response", parent_id: "evt-0022-a1b2c3d4",
    agent_id: AGENT_ID,
    payload: {
      model: "claude-sonnet-4-6-20260315",
      content: "## Changes Made\n\n### New file: `src/utils/validation.ts`\n- Email format validation using regex\n- Password strength validation (min 8 chars, 1 uppercase, 1 number)\n- Username validation (3-50 chars, alphanumeric + hyphens/underscores)\n\n### Updated: `src/routes/auth.ts`\n- Added import for validation functions\n- Added validation step before user creation\n- Returns 400 with detailed error messages for invalid input\n- Added explicit username uniqueness check before insert\n\n### Tests\nAll 8 registration tests pass, including new validation cases.\n\n### Security\n- Verified `.env` is gitignored\n- No secrets hardcoded in source files",
      usage: { prompt_tokens: 2341, completion_tokens: 198 },
      finish_reason: "stop"
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "output.classification": "safe", "output.delivery_action": "deliver" },
    schema_version: SCHEMA_VERSION
  },

  // 24: observation — guard check on output delivery
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 24,
    timestamp: ts(39), event_type: "observation", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      source: "output_guard",
      content: {
        scan_result: "clean",
        checks_performed: ["secret_leak_scan", "pii_scan", "prompt_injection_scan"],
        findings: []
      }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: { "output.guard_pass": true, "output.checks_count": 3 },
    schema_version: SCHEMA_VERSION
  },

  // 25: lifecycle — session_end
  {
    event_id: eventId(), session_id: SESSION_ID, sequence_num: 25,
    timestamp: ts(40), event_type: "lifecycle", parent_id: null,
    agent_id: AGENT_ID,
    payload: {
      action: "session_end",
      context: {
        total_events: 26,
        total_tool_calls: 7,
        total_llm_requests: 3,
        duration_ms: 40000,
        files_created: 1,
        files_modified: 1,
        tests_passed: 8,
        tests_failed: 0,
        redacted_fields: 4
      }
    },
    redacted: false, prev_hash: "", event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION
  }
];

// Compute valid hash chain using Krynix's actual implementation
const hashedEvents = computeHashChain(rawEvents as TraceEvent[]);

// Output as JSONL (canonical JSON, one event per line)
for (const event of hashedEvents) {
  console.log(canonicalize(event));
}
