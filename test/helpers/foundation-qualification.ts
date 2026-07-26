import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { runGit } from "./subprocess.js";

export const FOUNDATION_QUALIFICATION_PROFILE = {
  humanNotes: 1_000,
  dailyNotes: 365,
  connections: 5_000,
  maximumMarkdownBytes: 25 * 1024 * 1024
} as const;

export const FOUNDATION_PERFORMANCE_BUDGETS_MS = {
  coldStartup: 5_000,
  searchP95: 200,
  projectedReadP95: 100,
  canonicalSaveP95: 500,
  dirtyCheckpoint: 3_000,
  routeTransitionP95: 300
} as const;

export const FOUNDATION_QUALIFICATION_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 }
] as const;

export type FoundationQualificationFixture = {
  humanNotes: number;
  dailyNotes: number;
  connections: number;
  maximumMarkdownBytes: number;
  markdownBytes: number;
  fixtureDigest: string;
  representativeNoteId: string;
  representativeDailyDate: string;
};

const CREATED = "2025-01-01T00:00:00.000Z";
const REPRESENTATIVE_DAILY_DATE = "2025-12-31";

const PROJECT_TYPE = `---
_schema: fumori.model.type
_version: 1
key: project
name: Project
space: human
properties:
  - key: priority
    name: Priority
    kind: select
    options: [low, medium, high]
    default: medium
    required: true
---

# Project
`;

const RELATED_TO_RELATIONSHIP = `---
_schema: fumori.model.relationship
_version: 1
key: related_to
name: Related to
cardinality: one
inverse: related_from
target_types: []
---

# Related to
`;

const ACTIVE_PROJECTS_VIEW = `---
_schema: fumori.model.view
_version: 1
key: active-projects
name: Active projects
space: human
query:
  filter:
    all:
      - field: type
        operator: equals
        value: project
      - field: state
        operator: equals
        value: organized
  order:
    - field: title
      direction: ascending
  group_by: priority
  layout: table
  visible_columns: [title, priority, state]
---

# Active projects
`;

function fixedUuid(namespace: "human" | "daily", index: number): string {
  const namespaceDigit = namespace === "human" ? "0" : "1";
  return `00000000-0000-4000-8000-${namespaceDigit}${String(index).padStart(11, "0")}`;
}

function noteTitle(index: number): string {
  return `Qualification Note ${String(index).padStart(4, "0")}`;
}

function humanNoteSource(index: number): string {
  const type = index % 4 === 0 ? "project" : "note";
  const state = ["captured", "organized", "archived"][index % 3]!;
  const resolvedTargets = [1, 7, 29].map(
    (offset) =>
      noteTitle((index + offset) % FOUNDATION_QUALIFICATION_PROFILE.humanNotes)
  );
  const relationshipTarget = noteTitle(
    (index + 113) % FOUNDATION_QUALIFICATION_PROFILE.humanNotes
  );
  const projectProperty = type === "project"
    ? `priority: ${["low", "medium", "high"][index % 3]}\n`
    : "";

  return `---
_id: ${fixedUuid("human", index)}
_schema: fumori.note
_version: 1
_created: ${CREATED}
type: ${type}
state: ${state}
tags: [qualification, cohort-${index % 10}]
aliases: [Q${String(index).padStart(4, "0")}]
${projectProperty}related_to: "[[${relationshipTarget}]]"
---

# ${noteTitle(index)}

Deterministic marker qualification-${String(index).padStart(4, "0")}.

Links: [[${resolvedTargets[0]}]], [[${resolvedTargets[1]}|nearby note]], and [[${resolvedTargets[2]}]].

Unresolved evidence: [[Missing Qualification Target ${String(index).padStart(4, "0")}]].
`;
}

function dateAt(index: number): string {
  const date = new Date(Date.UTC(2025, 0, 1 + index));
  return date.toISOString().slice(0, 10);
}

function dailyNoteSource(index: number): string {
  const date = dateAt(index);
  return `---
_id: ${fixedUuid("daily", index)}
_schema: fumori.daily-note
_version: 1
_created: ${CREATED}
type: daily-note
state: organized
tags: [qualification, daily]
aliases: []
date: ${date}
---

# ${date}

Qualification Daily Note ${String(index + 1).padStart(3, "0")}.
`;
}

async function writeInBatches(
  files: ReadonlyArray<{ path: string; source: string }>
): Promise<void> {
  for (let start = 0; start < files.length; start += 100) {
    await Promise.all(
      files
        .slice(start, start + 100)
        .map(({ path, source }) => writeFile(path, source, "utf8"))
    );
  }
}

async function markdownPaths(root: string, directory = root): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await markdownPaths(root, path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(path);
    }
  }
  return paths.sort((left, right) =>
    relative(root, left).localeCompare(relative(root, right))
  );
}

export function p95(samples: readonly number[]): number {
  if (samples.length === 0) {
    throw new Error("P95 requires at least one sample");
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1]!;
}

export async function createFoundationQualificationFixture(
  vaultPath: string
): Promise<FoundationQualificationFixture> {
  const generatedFiles = [
    {
      path: join(
        vaultPath,
        ".second-brain",
        "model",
        "types",
        "project.md"
      ),
      source: PROJECT_TYPE
    },
    {
      path: join(
        vaultPath,
        ".second-brain",
        "model",
        "relationships",
        "related_to.md"
      ),
      source: RELATED_TO_RELATIONSHIP
    },
    {
      path: join(
        vaultPath,
        ".second-brain",
        "model",
        "views",
        "active-projects.md"
      ),
      source: ACTIVE_PROJECTS_VIEW
    },
    ...Array.from(
      { length: FOUNDATION_QUALIFICATION_PROFILE.humanNotes },
      (_, index) => ({
        path: join(
          vaultPath,
          "human",
          "notes",
          `qualification-note-${String(index).padStart(4, "0")}.md`
        ),
        source: humanNoteSource(index)
      })
    ),
    ...Array.from(
      { length: FOUNDATION_QUALIFICATION_PROFILE.dailyNotes },
      (_, index) => ({
        path: join(vaultPath, "human", "daily", `${dateAt(index)}.md`),
        source: dailyNoteSource(index)
      })
    )
  ];

  await writeInBatches(generatedFiles);

  const humanNoteFiles = generatedFiles.filter(({ path }) =>
    path.includes(`${join("human", "notes")}/`)
  );
  const dailyNoteFiles = generatedFiles.filter(({ path }) =>
    path.includes(`${join("human", "daily")}/`)
  );
  const connections = humanNoteFiles.reduce(
    (total, { source }) => total + [...source.matchAll(/\[\[[^\]\n]+\]\]/g)].length,
    0
  );
  const actualProfile = {
    humanNotes: humanNoteFiles.length,
    dailyNotes: dailyNoteFiles.length,
    connections
  };
  for (const key of ["humanNotes", "dailyNotes", "connections"] as const) {
    if (actualProfile[key] !== FOUNDATION_QUALIFICATION_PROFILE[key]) {
      throw new Error(
        `Foundation fixture has ${actualProfile[key]} ${key}; expected ${FOUNDATION_QUALIFICATION_PROFILE[key]}`
      );
    }
  }

  const fixtureDigest = createHash("sha256");
  for (const { path, source } of generatedFiles
    .map((file) => ({ ...file, relativePath: relative(vaultPath, file.path) }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    fixtureDigest.update(relative(vaultPath, path));
    fixtureDigest.update("\0");
    fixtureDigest.update(source);
    fixtureDigest.update("\0");
  }

  const allMarkdown = await markdownPaths(vaultPath);
  const markdownBytes = (
    await Promise.all(
      allMarkdown.map(async (path) => Buffer.byteLength(await readFile(path)))
    )
  ).reduce((total, bytes) => total + bytes, 0);
  if (
    markdownBytes >
    FOUNDATION_QUALIFICATION_PROFILE.maximumMarkdownBytes
  ) {
    throw new Error(
      `Foundation fixture uses ${markdownBytes} Markdown bytes; maximum is ${FOUNDATION_QUALIFICATION_PROFILE.maximumMarkdownBytes}`
    );
  }

  await runGit(vaultPath, "add", "--all");
  await runGit(
    vaultPath,
    "-c",
    "user.name=Fumori Qualification",
    "-c",
    "user.email=qualification@localhost",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--quiet",
    "--message",
    "Install Foundation qualification fixture"
  );

  return {
    ...actualProfile,
    maximumMarkdownBytes:
      FOUNDATION_QUALIFICATION_PROFILE.maximumMarkdownBytes,
    markdownBytes,
    fixtureDigest: fixtureDigest.digest("hex"),
    representativeNoteId: fixedUuid("human", 0),
    representativeDailyDate: REPRESENTATIVE_DAILY_DATE
  };
}
