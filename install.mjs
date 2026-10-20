#!/usr/bin/env node
/**
 * Install dsh-codex-worktree into a DSH profile (direct-install path).
 *
 * What it does
 *   1. copies package.json, cordis.patch.yml, README*.md, lib/** and client/**
 *      into <profile>/node_modules/dsh-codex-worktree/ (client/ and lib/ are
 *      copied recursively; a missing half aborts the install);
 *   2. runs `node --check` on every .js file in the staged copy *before*
 *      publishing it, so a broken copy can never reach the live profile;
 *   3. backs up <profile>/cordis.patch.yml to .bak-<ISO-timestamp> and appends
 *      the marked patch block (the package's cordis.patch.yml minus comment
 *      lines). If the marker is already present the append is skipped;
 *   4. prints files, backup paths and next steps.
 *
 * It does NOT edit the profile's package.json, does NOT run pnpm/npm, and does
 * NOT restart DSH.
 *
 * Usage
 *   node install.mjs --dry-run
 *   node install.mjs
 *   node install.mjs --profile web
 *   DSH_HOME=/path/to/.dsh node install.mjs --profile desktop
 *
 * Environment
 *   DSH_HOME     DSH home directory (default: ~/.dsh)
 *   DSH_PROFILE  profile name (default: desktop; --profile wins)
 *
 * Exit codes
 *   0  installed (or dry-run printed)
 *   1  invalid arguments
 *   2  missing profile / profile patch / required source files
 *   3  `node --check` failed
 *   4  filesystem or patch write failed
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'dsh-codex-worktree';
const here = path.dirname(fileURLToPath(import.meta.url));
const markerStart = `# >>> ${PACKAGE_NAME} >>>`;
const markerEnd = `# <<< ${PACKAGE_NAME} <<<`;

/** Entries never copied from lib/ and client/. */
const IGNORED_DIRS = new Set(['node_modules', '.git']);
const IGNORED_FILES = new Set(['.DS_Store']);

/** Files that must exist in the package before an install may write anything. */
const REQUIRED_FILES = ['package.json', 'cordis.patch.yml'];
/** Directories that must exist (copy recursively). */
const REQUIRED_DIRS = ['lib', 'client'];
/** Optional per-directory docs copied when present. */
const OPTIONAL_README = /^README.*\.md$/i;

const CLEANUP = new Set(['--dry-run', '--profile', '-h', '--help']);

function fail(message, code = 1) {
  console.error(`\nerror: ${message}`);
  process.exit(code);
}

function usage() {
  console.log(`Usage: node install.mjs [--dry-run] [--profile <name>]

Copies ${PACKAGE_NAME} into a DSH profile and appends its marked patch block
to <profile>/cordis.patch.yml. Restart DSH afterwards.

Options:
  --profile <name>  profile to install into (default: $DSH_PROFILE or "desktop")
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
    } else if (CLEANUP.has(arg)) {
      // handled above; keeps the set referenced for completeness
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
const nodeModulesDir = path.join(profileDir, 'node_modules');
const targetDir = path.join(nodeModulesDir, PACKAGE_NAME);
const patchPath = path.join(profileDir, 'cordis.patch.yml');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const stagingDir = path.join(profileDir, `.${PACKAGE_NAME}.staging-${stamp}-${process.pid}`);
const previousDir = path.join(profileDir, `.${PACKAGE_NAME}.previous-${stamp}`);

// ---------------------------------------------------------------------------
// Source inventory
// ---------------------------------------------------------------------------

/** Recursively list files below `dir`, relative to `root`, sorted. */
function walk(root, dir = root) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...walk(root, absolute));
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name)) continue;
      out.push(relative);
    }
  }
  return out;
}

const problems = []; // fatal for a real install, warnings for --dry-run

function requireFile(relative) {
  const absolute = path.join(here, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    problems.push(`missing source file: ${absolute}`);
    return false;
  }
  return true;
}

function requireDir(relative) {
  const absolute = path.join(here, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    problems.push(`missing source directory: ${absolute}`);
    return false;
  }
  return true;
}

for (const relative of REQUIRED_FILES) requireFile(relative);
const dirsOk = REQUIRED_DIRS.map((relative) => requireDir(relative));

const copyList = [];
for (const relative of REQUIRED_FILES) {
  if (fs.existsSync(path.join(here, relative))) copyList.push(relative);
}
for (const relative of fs.readdirSync(here).sort()) {
  if (OPTIONAL_README.test(relative) && fs.statSync(path.join(here, relative)).isFile()) {
    copyList.push(relative);
  }
}
for (const relative of REQUIRED_DIRS) {
  if (!dirsOk[REQUIRED_DIRS.indexOf(relative)]) continue;
  for (const child of walk(path.join(here, relative))) {
    copyList.push(path.join(relative, child));
  }
}
const uniqueCopyList = [...new Set(copyList)].sort();
const jsFiles = uniqueCopyList.filter((relative) => /\.(?:js|mjs|cjs)$/i.test(relative));

// ---------------------------------------------------------------------------
// Patch body: the package's cordis.patch.yml without comment lines.
// The file is a top-level YAML array whose single entry is `- insert:`; the
// body can therefore be embedded inside the profile patch as-is.
// ---------------------------------------------------------------------------

let patchBody = '';
let patchBodyError = null;
const sourcePatchPath = path.join(here, 'cordis.patch.yml');
if (fs.existsSync(sourcePatchPath)) {
  const lines = fs.readFileSync(sourcePatchPath, 'utf8').split(/\r?\n/);
  patchBody = lines
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
  if (!/^- /.test(patchBody.trimStart())) {
    patchBodyError = `patch body in ${sourcePatchPath} is not a top-level YAML array (expected a line starting with "- "); refusing to embed it`;
  }
}

const patchBlock = [markerStart, patchBody, markerEnd, ''].join('\n');

// ---------------------------------------------------------------------------
// Plan / checks
// ---------------------------------------------------------------------------

const profileExists = fs.existsSync(profileDir);
const patchExists = fs.existsSync(patchPath);
const targetExists = fs.existsSync(targetDir);
let patchText = '';
let alreadyPatched = false;
if (patchExists) {
  try {
    patchText = fs.readFileSync(patchPath, 'utf8');
    alreadyPatched = patchText.includes(markerStart);
  } catch (error) {
    problems.push(`cannot read profile patch ${patchPath}: ${error.message}`);
  }
} else {
  problems.push(`missing profile patch: ${patchPath}`);
}
if (!profileExists) problems.push(`missing profile directory: ${profileDir}`);

if (patchBodyError) problems.push(patchBodyError);

// Report --dry-run warnings but still print the plan; a real install aborts
// before touching anything.
if (problems.length > 0 && !args.dryRun) {
  console.error('Refusing to install:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\nNothing was written. Check the package at ${here}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Dry run: print the whole plan and exit without a single write.
// ---------------------------------------------------------------------------

if (args.dryRun) {
  console.log(`${PACKAGE_NAME} installer (dry run)`);
  console.log(`source        ${here}`);
  console.log(`DSH home      ${dshHome}`);
  console.log(`profile       ${args.profile} -> ${profileDir}`);
  console.log(`target        ${targetDir}${targetExists ? ' (exists; would be replaced and kept as a backup)' : ' (new)'}`);
  console.log(`profile patch ${patchPath}${patchExists ? '' : ' (MISSING -> real install would abort)'}`);
  console.log(`marker        ${alreadyPatched ? 'present -> append would be SKIPPED' : 'absent -> marked block would be appended'}`);
  console.log(`backup        ${patchPath}.bak-<ISO-timestamp>${alreadyPatched ? ' (none: marker present)' : ''}`);
  console.log(`staging       ${stagingDir} (temporary; removed after publish)`);
  console.log('');
  console.log(`Files to copy (${uniqueCopyList.length}):`);
  for (const relative of uniqueCopyList) {
    const absolute = path.join(here, relative);
    let size = '?';
    try {
      size = String(fs.statSync(absolute).size);
    } catch {
      // leave '?'
    }
    console.log(`  ${relative}  (${size} bytes)`);
  }
  console.log('');
  console.log(`Syntax check: ${jsFiles.length} file(s) would run through \`node --check\` before publishing:`);
  for (const relative of jsFiles) console.log(`  ${relative}`);
  console.log('');
  console.log('Patch block that would be appended to the profile patch:');
  console.log('');
  console.log(patchBlock.trimEnd());
  console.log('');
  if (problems.length > 0) {
    console.log('Warnings (a real install would abort on these):');
    for (const problem of problems) console.log(`  - ${problem}`);
    console.log('');
  }
  console.log('--dry-run: no files were written.');
  console.log('Notes: the profile package.json is not touched; no pnpm/npm is run; DSH is not restarted.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Real install
// ---------------------------------------------------------------------------

function checkSyntax(jsPaths) {
  for (const absolute of jsPaths) {
    try {
      execFileSync(process.execPath, ['--check', absolute], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      const stderr = (error.stderr || '').toString().trim();
      const failure = new Error(`node --check failed for ${absolute}${stderr ? `\n${stderr}` : ''}`);
      failure.exitCode = 3;
      throw failure;
    }
  }
}

function uniqueBackupPath(base) {
  let candidate = base;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function appendPatchBlock() {
  const current = fs.readFileSync(patchPath, 'utf8');
  if (current.includes(markerStart)) return { appended: false, backup: null };
  const backup = uniqueBackupPath(`${patchPath}.bak-${stamp}`);
  fs.copyFileSync(patchPath, backup);
  try {
    const prefix = current.endsWith('\n') ? current : `${current}\n`;
    const next = `${prefix}\n${patchBlock}`;
    fs.writeFileSync(patchPath, next, 'utf8');
  } catch (error) {
    try {
      fs.copyFileSync(backup, patchPath);
    } catch {
      // best effort; the backup path is reported below
    }
    throw new Error(`could not append the patch block to ${patchPath}; original restored from ${backup}: ${error.message}`);
  }
  const written = fs.readFileSync(patchPath, 'utf8');
  if (!written.includes(markerStart) || !written.includes(patchBody.trim())) {
    try {
      fs.copyFileSync(backup, patchPath);
    } catch {
      // best effort
    }
    throw new Error(`patch verification failed for ${patchPath}; original restored from ${backup}`);
  }
  return { appended: true, backup };
}

let published = false;
let previousBackup = null;
let patchBackup = null;
let patchAppended = false;

try {
  // 1. Validate the sources before writing anything. Byte-identical copies
  // cannot fail afterwards, so a broken source half never reaches the profile.
  const sourceStats = new Map(
    uniqueCopyList.map((relative) => {
      const stat = fs.statSync(path.join(here, relative));
      return [relative, { size: stat.size, mtimeMs: stat.mtimeMs }];
    }),
  );
  checkSyntax(jsFiles.map((relative) => path.join(here, relative)));

  // 2. Stage the copy next to the profile (never inside node_modules, so a
  // crashed install cannot leave a half-package that the loader might see).
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const relative of uniqueCopyList) {
    const destination = path.join(stagingDir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(here, relative), destination);
  }
  checkSyntax(jsFiles.map((relative) => path.join(stagingDir, relative)));

  // Refuse to publish a snapshot taken while the package was still being
  // edited (for example a host half written by a parallel build).
  for (const relative of uniqueCopyList) {
    const before = sourceStats.get(relative);
    const now = fs.statSync(path.join(here, relative));
    if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
      throw new Error(`source file changed during install: ${path.join(here, relative)} (re-run once the package is stable)`);
    }
  }

  // 3. Publish the staged copy.
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  if (fs.existsSync(targetDir)) {
    const previousTarget = uniqueBackupPath(previousDir);
    fs.renameSync(targetDir, previousTarget);
    previousBackup = previousTarget;
  }
  fs.renameSync(stagingDir, targetDir);
  published = true;

  // 4. Patch the profile.
  const patchResult = appendPatchBlock();
  patchAppended = patchResult.appended;
  patchBackup = patchResult.backup;
} catch (error) {
  // Roll back: remove the half-published copy and restore the previous one.
  try {
    if (published && fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    if (previousBackup && fs.existsSync(previousBackup)) fs.renameSync(previousBackup, targetDir);
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch (rollbackError) {
    console.error(`rollback failed: ${rollbackError.message}`);
  }
  fail(error.message || String(error), error.exitCode || 4);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`${PACKAGE_NAME} installed`);
console.log(`source        ${here}`);
console.log(`target        ${targetDir}`);
console.log(`copied        ${uniqueCopyList.length} files`);
console.log(`syntax check  ${jsFiles.length} .js file(s) passed node --check`);
if (patchAppended) {
  console.log(`patched       ${patchPath}`);
  console.log(`backup        ${patchBackup}`);
} else {
  console.log(`patch         ${patchPath} already contains the marker; skipped`);
}
if (previousBackup) console.log(`previous      ${previousBackup} (kept as a rollback snapshot)`);
console.log('');
console.log('Not done on purpose: the profile package.json is untouched, no pnpm/npm ran, DSH was not restarted.');
console.log('Next: finish or stop any running tasks, then quit and reopen DSH (desktop app restart, not a page refresh).');
if (patchAppended) {
  console.log(`Rollback: node uninstall.mjs  (or restore ${patchBackup})`);
} else {
  console.log('Rollback: node uninstall.mjs');
}
