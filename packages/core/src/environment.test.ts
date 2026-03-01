import { describe, test, expect } from "vitest";
import { detectEnvironment, mergeEnvironmentContext } from "./environment.js";
import type { EnvironmentContext } from "./environment.js";

// ---------------------------------------------------------------------------
// detectEnvironment
// ---------------------------------------------------------------------------

describe("detectEnvironment", () => {
  test("detects GitHub Actions", () => {
    const ctx = detectEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_SHA: "abc123",
      GITHUB_RUN_ID: "456",
      GITHUB_REF_NAME: "main",
      GITHUB_REPOSITORY: "org/repo",
      GITHUB_SERVER_URL: "https://github.com",
    });

    expect(ctx.ci_provider).toBe("github-actions");
    expect(ctx.git_sha).toBe("abc123");
    expect(ctx.ci_run_id).toBe("456");
    expect(ctx.git_branch).toBe("main");
    expect(ctx.git_repository).toBe("org/repo");
    expect(ctx.ci_run_url).toBe("https://github.com/org/repo/actions/runs/456");
    expect(ctx.extra).toEqual({});
  });

  test("detects GitLab CI", () => {
    const ctx = detectEnvironment({
      GITLAB_CI: "true",
      CI_COMMIT_SHA: "def456",
      CI_PIPELINE_ID: "789",
      CI_COMMIT_BRANCH: "develop",
      CI_PROJECT_PATH: "group/project",
      CI_PIPELINE_URL: "https://gitlab.com/group/project/-/pipelines/789",
    });

    expect(ctx.ci_provider).toBe("gitlab-ci");
    expect(ctx.git_sha).toBe("def456");
    expect(ctx.ci_run_id).toBe("789");
    expect(ctx.git_branch).toBe("develop");
    expect(ctx.git_repository).toBe("group/project");
    expect(ctx.ci_run_url).toBe("https://gitlab.com/group/project/-/pipelines/789");
  });

  test("detects Jenkins", () => {
    const ctx = detectEnvironment({
      JENKINS_URL: "https://jenkins.example.com/",
      GIT_COMMIT: "aaa111",
      BUILD_NUMBER: "42",
      GIT_BRANCH: "origin/main",
      GIT_URL: "https://github.com/org/repo.git",
      BUILD_URL: "https://jenkins.example.com/job/my-job/42/",
    });

    expect(ctx.ci_provider).toBe("jenkins");
    expect(ctx.git_sha).toBe("aaa111");
    expect(ctx.ci_run_id).toBe("42");
    expect(ctx.git_branch).toBe("origin/main");
    expect(ctx.git_repository).toBe("https://github.com/org/repo.git");
    expect(ctx.ci_run_url).toBe("https://jenkins.example.com/job/my-job/42/");
  });

  test("detects CircleCI", () => {
    const ctx = detectEnvironment({
      CIRCLECI: "true",
      CIRCLE_SHA1: "bbb222",
      CIRCLE_BUILD_NUM: "55",
      CIRCLE_BRANCH: "feature/x",
      CIRCLE_PROJECT_REPONAME: "my-repo",
      CIRCLE_BUILD_URL: "https://circleci.com/gh/org/my-repo/55",
    });

    expect(ctx.ci_provider).toBe("circleci");
    expect(ctx.git_sha).toBe("bbb222");
    expect(ctx.ci_run_id).toBe("55");
    expect(ctx.git_branch).toBe("feature/x");
    expect(ctx.git_repository).toBe("my-repo");
    expect(ctx.ci_run_url).toBe("https://circleci.com/gh/org/my-repo/55");
  });

  test("detects Travis CI", () => {
    const ctx = detectEnvironment({
      TRAVIS: "true",
      TRAVIS_COMMIT: "ccc333",
      TRAVIS_BUILD_ID: "999",
      TRAVIS_BRANCH: "release/1.0",
      TRAVIS_REPO_SLUG: "org/repo",
    });

    expect(ctx.ci_provider).toBe("travis-ci");
    expect(ctx.git_sha).toBe("ccc333");
    expect(ctx.ci_run_id).toBe("999");
    expect(ctx.git_branch).toBe("release/1.0");
    expect(ctx.git_repository).toBe("org/repo");
    expect(ctx.ci_run_url).toBeNull();
  });

  test("detects unknown CI when CI=true", () => {
    const ctx = detectEnvironment({ CI: "true" });

    expect(ctx.ci_provider).toBe("unknown-ci");
    expect(ctx.ci_run_id).toBeNull();
    expect(ctx.ci_run_url).toBeNull();
    expect(ctx.git_sha).toBeNull();
    expect(ctx.git_branch).toBeNull();
    expect(ctx.git_repository).toBeNull();
    expect(ctx.extra).toEqual({});
  });

  test("accepts '1' as truthy for CI boolean env vars", () => {
    const ctx = detectEnvironment({
      GITHUB_ACTIONS: "1",
      GITHUB_SHA: "sha-from-1",
      GITHUB_RUN_ID: "42",
    });
    expect(ctx.ci_provider).toBe("github-actions");
    expect(ctx.git_sha).toBe("sha-from-1");
  });

  test("accepts 'yes' as truthy for CI boolean env vars", () => {
    const ctx = detectEnvironment({ CI: "yes" });
    expect(ctx.ci_provider).toBe("unknown-ci");
  });

  test("accepts 'TRUE' (uppercase) as truthy for CI boolean env vars", () => {
    const ctx = detectEnvironment({
      GITLAB_CI: "TRUE",
      CI_COMMIT_SHA: "abc",
    });
    expect(ctx.ci_provider).toBe("gitlab-ci");
    expect(ctx.git_sha).toBe("abc");
  });

  test("returns null provider when not in CI", () => {
    const ctx = detectEnvironment({});

    expect(ctx.ci_provider).toBeNull();
    expect(ctx.ci_run_id).toBeNull();
    expect(ctx.ci_run_url).toBeNull();
    expect(ctx.git_sha).toBeNull();
    expect(ctx.git_branch).toBeNull();
    expect(ctx.git_repository).toBeNull();
    expect(ctx.extra).toEqual({});
  });

  test("empty string env vars treated as absent", () => {
    const ctx = detectEnvironment({
      GITHUB_ACTIONS: "",
      CI: "",
    });

    expect(ctx.ci_provider).toBeNull();
  });

  test("provider-specific var overrides generic CI", () => {
    const ctx = detectEnvironment({
      GITHUB_ACTIONS: "true",
      CI: "true",
      GITHUB_SHA: "abc",
      GITHUB_RUN_ID: "1",
      GITHUB_REF_NAME: "main",
      GITHUB_REPOSITORY: "org/repo",
      GITHUB_SERVER_URL: "https://github.com",
    });

    expect(ctx.ci_provider).toBe("github-actions");
  });

  test("GitHub Actions ci_run_url computed correctly", () => {
    const ctx = detectEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "org/repo",
      GITHUB_RUN_ID: "123",
    });

    expect(ctx.ci_run_url).toBe("https://github.com/org/repo/actions/runs/123");
  });

  test("GitLab ci_run_url from CI_PIPELINE_URL", () => {
    const ctx = detectEnvironment({
      GITLAB_CI: "true",
      CI_PIPELINE_URL: "https://gitlab.com/my/project/-/pipelines/100",
    });

    expect(ctx.ci_run_url).toBe("https://gitlab.com/my/project/-/pipelines/100");
  });

  test("Jenkins ci_run_url from BUILD_URL", () => {
    const ctx = detectEnvironment({
      JENKINS_URL: "https://jenkins.example.com/",
      BUILD_URL: "https://jenkins.example.com/job/build/1/",
    });
    expect(ctx.ci_run_url).toBe("https://jenkins.example.com/job/build/1/");
  });

  test("CircleCI ci_run_url from CIRCLE_BUILD_URL", () => {
    const ctx = detectEnvironment({
      CIRCLECI: "true",
      CIRCLE_BUILD_URL: "https://circleci.com/gh/org/repo/10",
    });

    expect(ctx.ci_run_url).toBe("https://circleci.com/gh/org/repo/10");
  });

  test("multiple CI vars present — first provider match wins", () => {
    const ctx = detectEnvironment({
      GITHUB_ACTIONS: "true",
      GITLAB_CI: "true",
      GITHUB_SHA: "gh-sha",
      CI_COMMIT_SHA: "gl-sha",
    });

    expect(ctx.ci_provider).toBe("github-actions");
    expect(ctx.git_sha).toBe("gh-sha");
  });

  test("Jenkins without BUILD_URL has null ci_run_url", () => {
    const ctx = detectEnvironment({
      JENKINS_URL: "https://jenkins.example.com/",
      GIT_COMMIT: "abc",
      BUILD_NUMBER: "1",
    });

    expect(ctx.ci_provider).toBe("jenkins");
    expect(ctx.ci_run_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeEnvironmentContext
// ---------------------------------------------------------------------------

describe("mergeEnvironmentContext", () => {
  const detected: EnvironmentContext = {
    ci_provider: "github-actions",
    ci_run_id: "100",
    ci_run_url: "https://github.com/org/repo/actions/runs/100",
    git_sha: "original-sha",
    git_branch: "main",
    git_repository: "org/repo",
    extra: { key1: "val1" },
  };

  test("combines detected + overrides", () => {
    const merged = mergeEnvironmentContext(detected, {
      git_sha: "override-sha",
    });

    expect(merged.ci_provider).toBe("github-actions");
    expect(merged.git_sha).toBe("override-sha");
    expect(merged.ci_run_id).toBe("100");
  });

  test("keeps detected when no override", () => {
    const merged = mergeEnvironmentContext(detected, {});

    expect(merged.ci_provider).toBe("github-actions");
    expect(merged.git_sha).toBe("original-sha");
    expect(merged.ci_run_id).toBe("100");
    expect(merged.ci_run_url).toBe("https://github.com/org/repo/actions/runs/100");
    expect(merged.git_branch).toBe("main");
    expect(merged.git_repository).toBe("org/repo");
  });

  test("extra field passes through", () => {
    const base = detectEnvironment({});
    expect(base.extra).toEqual({});

    const merged = mergeEnvironmentContext(base, {
      extra: { custom: "value" },
    });
    expect(merged.extra).toEqual({ custom: "value" });
  });

  test("merges extra fields with override wins on conflicts", () => {
    const merged = mergeEnvironmentContext(detected, {
      extra: { key1: "overridden", key2: "new" },
    });

    expect(merged.extra).toEqual({ key1: "overridden", key2: "new" });
  });

  test("merge with empty overrides is identity", () => {
    const merged = mergeEnvironmentContext(detected, {});

    expect(merged.ci_provider).toBe(detected.ci_provider);
    expect(merged.ci_run_id).toBe(detected.ci_run_id);
    expect(merged.ci_run_url).toBe(detected.ci_run_url);
    expect(merged.git_sha).toBe(detected.git_sha);
    expect(merged.git_branch).toBe(detected.git_branch);
    expect(merged.git_repository).toBe(detected.git_repository);
    expect(merged.extra).toEqual(detected.extra);
  });
});
