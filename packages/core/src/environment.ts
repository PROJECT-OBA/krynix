/**
 * CI/Git environment context detection.
 *
 * Pure functions that detect CI provider, git info, and run metadata
 * from environment variables. Used by compliance bundles and session
 * management to embed searchable context in traces.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** CI/git environment context detected from environment variables. */
export interface EnvironmentContext {
  /** CI provider name (e.g., "github-actions", "gitlab-ci", "jenkins"). Null if not in CI. */
  ci_provider: string | null;
  /** CI pipeline/workflow run ID. */
  ci_run_id: string | null;
  /** CI pipeline/workflow run URL. */
  ci_run_url: string | null;
  /** Git commit SHA. */
  git_sha: string | null;
  /** Git branch name. */
  git_branch: string | null;
  /** Git repository URL or slug. */
  git_repository: string | null;
  /** Additional key-value pairs (user-supplied). */
  extra: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return env var value only if it is a non-empty string. */
function getEnv(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key];
  return value && value.length > 0 ? value : null;
}

/** Check if an env var is set to a truthy value (true, 1, yes). */
function isTruthy(env: Record<string, string | undefined>, key: string): boolean {
  const value = getEnv(env, key);
  if (value === null) return false;
  const lower = value.toLowerCase();
  return lower === "true" || lower === "1" || lower === "yes";
}

/** Construct a null-result context. */
function nullContext(): EnvironmentContext {
  return {
    ci_provider: null,
    ci_run_id: null,
    ci_run_url: null,
    git_sha: null,
    git_branch: null,
    git_repository: null,
    extra: {},
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect environment context from environment variables.
 *
 * Supports: GitHub Actions, GitLab CI, Jenkins, CircleCI, Travis CI.
 * Pure function -- takes env as parameter for testability.
 *
 * @param env - Environment variable map (defaults to `process.env`)
 * @returns Detected environment context
 */
export function detectEnvironment(
  env: Record<string, string | undefined> = process.env,
): EnvironmentContext {
  // GitHub Actions
  if (isTruthy(env, "GITHUB_ACTIONS")) {
    const serverUrl = getEnv(env, "GITHUB_SERVER_URL");
    const repo = getEnv(env, "GITHUB_REPOSITORY");
    const runId = getEnv(env, "GITHUB_RUN_ID");
    let ciRunUrl: string | null = null;
    if (serverUrl && repo && runId) {
      ciRunUrl = `${serverUrl}/${repo}/actions/runs/${runId}`;
    }
    return {
      ci_provider: "github-actions",
      ci_run_id: runId,
      ci_run_url: ciRunUrl,
      git_sha: getEnv(env, "GITHUB_SHA"),
      git_branch: getEnv(env, "GITHUB_REF_NAME"),
      git_repository: repo,
      extra: {},
    };
  }

  // GitLab CI
  if (isTruthy(env, "GITLAB_CI")) {
    return {
      ci_provider: "gitlab-ci",
      ci_run_id: getEnv(env, "CI_PIPELINE_ID"),
      ci_run_url: getEnv(env, "CI_PIPELINE_URL"),
      git_sha: getEnv(env, "CI_COMMIT_SHA"),
      git_branch: getEnv(env, "CI_COMMIT_BRANCH"),
      git_repository: getEnv(env, "CI_PROJECT_PATH"),
      extra: {},
    };
  }

  // Jenkins
  if (getEnv(env, "JENKINS_URL") !== null) {
    return {
      ci_provider: "jenkins",
      ci_run_id: getEnv(env, "BUILD_NUMBER"),
      ci_run_url: getEnv(env, "BUILD_URL"),
      git_sha: getEnv(env, "GIT_COMMIT"),
      git_branch: getEnv(env, "GIT_BRANCH"),
      git_repository: getEnv(env, "GIT_URL"),
      extra: {},
    };
  }

  // CircleCI
  if (isTruthy(env, "CIRCLECI")) {
    return {
      ci_provider: "circleci",
      ci_run_id: getEnv(env, "CIRCLE_BUILD_NUM"),
      ci_run_url: getEnv(env, "CIRCLE_BUILD_URL"),
      git_sha: getEnv(env, "CIRCLE_SHA1"),
      git_branch: getEnv(env, "CIRCLE_BRANCH"),
      git_repository: getEnv(env, "CIRCLE_PROJECT_REPONAME"),
      extra: {},
    };
  }

  // Travis CI
  if (isTruthy(env, "TRAVIS")) {
    return {
      ci_provider: "travis-ci",
      ci_run_id: getEnv(env, "TRAVIS_BUILD_ID"),
      ci_run_url: null,
      git_sha: getEnv(env, "TRAVIS_COMMIT"),
      git_branch: getEnv(env, "TRAVIS_BRANCH"),
      git_repository: getEnv(env, "TRAVIS_REPO_SLUG"),
      extra: {},
    };
  }

  // Generic CI (CI=true/1/yes but no provider-specific vars)
  if (isTruthy(env, "CI")) {
    return {
      ...nullContext(),
      ci_provider: "unknown-ci",
    };
  }

  // Not in CI
  return nullContext();
}

/**
 * Merge detected context with manual overrides.
 *
 * Non-null/non-undefined override values replace detected values.
 * The `extra` field is shallow-merged (override keys win on conflicts).
 * Null/undefined override values do not replace detected values.
 *
 * @param detected - Auto-detected environment context
 * @param overrides - Manual override values
 * @returns Merged environment context
 */
export function mergeEnvironmentContext(
  detected: EnvironmentContext,
  overrides: Partial<EnvironmentContext>,
): EnvironmentContext {
  return {
    ci_provider: overrides.ci_provider ?? detected.ci_provider,
    ci_run_id: overrides.ci_run_id ?? detected.ci_run_id,
    ci_run_url: overrides.ci_run_url ?? detected.ci_run_url,
    git_sha: overrides.git_sha ?? detected.git_sha,
    git_branch: overrides.git_branch ?? detected.git_branch,
    git_repository: overrides.git_repository ?? detected.git_repository,
    extra: {
      ...detected.extra,
      ...(overrides.extra ?? {}),
    },
  };
}
