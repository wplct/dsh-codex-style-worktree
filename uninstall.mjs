#!/usr/bin/env node
/**
 * Uninstall dsh-codex-worktree from a DSH profile.
 *
 * What it does
 *   1. removes the marked patch block (markers and everything between them)
 *      from <profile>/cordis.patch.yml, after backing the file up to
 *      .bak-<ISO-timestamp>; every other line of the file is preserved;
 *   2. removes <profile>/node_modules/dsh-codex-worktree/ recursively;
 *   3. prints every action and backup path.
 *
 * Idempotent: running it twice is safe — the second run reports nothing to do
 * and exits 0. It never touches other plugins' lines or directories.
 *
 * Usage
 *   node uninstall.mjs --dry-run
 *   node uninstall.mjs
 *   node uninstall.mjs --profile web
 *   DSH_HOME=/path/to/.dsh node uninstall.mjs --profile desktop
 *
 * Exit codes
 *   0  done (or nothing to do, or dry-run printed)
 *   1  invalid arguments
 *   4  filesystem write failed
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PACKAGE_NAME = 'dsh-codex-worktree';
const markerStart = `# >>> ${PACKAGE_NAME} >>>`;
const markerEnd = `# <<< ${PACKAGE_NAME} <<<`;

function fail(message, code = 1) {
  console.error(`\nerror: ${message}`);
  process.exit(code);
}

function usage() {
  console.log(`Usage: node uninstall.mjs [--dry-run] [--profile <name>]

Removes the marked ${PACKAGE_NAME} patch block from <profile>/cordis.patch.yml
and deletes <profile>/node_modules/${PACKAGE_NAME}/. Restart DSH afterwards.

Options:
  --profile <name>  profile to uninstall from (default: $DSH_PROFILE or "desktop")
  --dry-run         print the plan, write nothing
  -h, --help        show this help

Environment:
  DSH_HOME          DSH home directory (default: ~/.dsh)
  DSH_PROFILE       default profile name (default: desktop)
`);
}

function parseArgs(argv) {
  const parsed = { dryRun: false, profile: process.env.DSH_PROFILE || 'desktop' };
  let profileGiven = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '--profile') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) fail('--profile requires a profile name', 1);
      parsed.profile = value;
      profileGiven = true;
      i += 1;
    } else if (arg.startsWith('--profile=')) {
      parsed.profile = arg.slice('--profile='.length);
      if (!parsed.profile) fail('--profile requires a profile name', 1);
      profileGiven = true;
    } else {
      fail(`unknown argument: ${arg} (try --help)`, 1);
    }
  }
  if (profileGiven && (parsed.profile.includes('/') || parsed.profile.includes('\\') || parsed.profile === '.' || parsed.profile === '..')) {
    fail(`invalid profile name: ${parsed.profile}`, 1);
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profileDir = path.join(dshHome, 'profiles', args.profile);
const targetDir = path.join(profileDir, 'node_modules', PACKAGE_NAME);
const patchPath = path.join(profileDir, 'cordis.patch.yml');
const stateDir = path.join(dshHome, PACKAGE_NAME);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function uniqueBackupPath(base) {
  let candidate = base;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

console.log(`${PACKAGE_NAME} uninstaller${args.dryRun ? ' (dry run)' : ''}`);
console.log(`DSH home      ${dshHome}`);
console.log(`profile       ${args.profile} -> ${profileDir}`);
console.log(`profile patch ${patchPath}`);

// ---------------------------------------------------------------------------
// Step 1: strip the marked patch block.
// ---------------------------------------------------------------------------

let removedBlock = false;
let patchBackup = null;
let patchPlan = 'no change';

if (!fs.existsSync(patchPath)) {
  patchPlan = 'profile patch missing; nothing to remove';
} else {
  const text = fs.readFileSync(patchPath, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === markerStart);
  let end = -1;
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i].trim() === markerEnd) {
        end = i;
        break;
      }
    }
  }
  if (start === -1) {
    patchPlan = 'no dsh-codex-worktree marker; skipped';
  } else if (end === -1) {
    patchPlan = `marker start found at line ${start + 1} but no end marker; refusing to guess, left untouched`;
  } else {
    const nextLines = [...lines.slice(0, start), ...lines.slice(end + 1)];
    const nextText = nextLines.join('\n');
    removedBlock = true;
    patchBackup = uniqueBackupPath(`${patchPath}.bak-${stamp}`);
    patchPlan = `remove lines ${start + 1}-${end + 1} (marked block)`;
    if (args.dryRun) {
      console.log(`would remove  ${patchPlan}`);
      console.log(`would backup  ${patchBackup}`);
    } else {
      try {
        fs.copyFileSync(patchPath, patchBackup);
        fs.writeFileSync(patchPath, nextText, 'utf8');
      } catch (error) {
        fail(`could not rewrite profile patch ${patchPath}: ${error.message}`, 4);
      }
      if (fs.readFileSync(patchPath, 'utf8').includes(markerStart)) {
        fail(`marker still present in ${patchPath} after rewrite; restore ${patchBackup}`, 4);
      }
      console.log(`removed patch block from ${patchPath}`);
      console.log(`backup        ${patchBackup}`);
    }
  }
}
if (!removedBlock) console.log(`patch         ${patchPlan}`);

// ---------------------------------------------------------------------------
// Step 2: delete the installed package.
// ---------------------------------------------------------------------------

if (fs.existsSync(targetDir)) {
  if (args.dryRun) {
    console.log(`would remove  ${targetDir}`);
  } else {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (error) {
      fail(`could not remove ${targetDir}: ${error.message}`, 4);
    }
    console.log(`removed       ${targetDir}`);
  }
} else {
  console.log(`package       not installed at ${targetDir}`);
}

// ---------------------------------------------------------------------------
// Step 3: report leftovers that are intentionally left alone.
// ---------------------------------------------------------------------------

if (fs.existsSync(profileDir)) {
  const previousSnapshots = fs
    .readdirSync(profileDir)
    .filter((name) => name.startsWith(`.${PACKAGE_NAME}.previous-`))
    .sort();
  if (previousSnapshots.length > 0) {
    console.log('');
    console.log('Install snapshots kept (delete manually once you no longer need a rollback):');
    for (const name of previousSnapshots) console.log(`  ${path.join(profileDir, name)}`);
  }
}

if (fs.existsSync(stateDir)) {
  console.log('');
  console.log(`Sidecar bookkeeping left in place: ${stateDir}`);
  console.log('It records created worktrees; delete it manually after the worktrees are gone.');
}

if (args.dryRun) {
  console.log('');
  console.log('--dry-run: no files were written.');
} else {
  console.log('');
  console.log('Next: finish or stop any running tasks, then quit and reopen DSH.');
}
