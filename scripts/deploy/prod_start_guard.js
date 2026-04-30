#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '../..');
const buildDir = path.join(workspaceRoot, '.next');
const standbyDir = path.join(workspaceRoot, '.next-standby');
const lockFile = path.join(workspaceRoot, '.next-build.lock');
const nextBin = path.join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const requiredBuildFiles = [
  'BUILD_ID',
  'routes-manifest.json',
  'prerender-manifest.json',
  path.join('server', 'app-paths-manifest.json'),
];

const port = String(process.env.PORT || '3000');
const host = process.env.HOST || '127.0.0.1';
const lockWaitTimeoutMs = Number(process.env.PROD_GUARD_LOCK_TIMEOUT_MS || 10 * 60 * 1000);
const lockPollMs = Number(process.env.PROD_GUARD_LOCK_POLL_MS || 2000);

function log(message) {
  const time = new Date().toISOString().replace('T', ' ').replace('Z', '');
  console.log(`[prod-start ${time}] ${message}`);
}

function fileExists(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureRemoved(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyDirectory(sourcePath, targetPath) {
  ensureRemoved(targetPath);
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function hasValidBuild(targetDir) {
  if (!fileExists(targetDir)) {
    return false;
  }

  return requiredBuildFiles.every((relativePath) => {
    const absolutePath = path.join(targetDir, relativePath);
    try {
      return fs.statSync(absolutePath).size >= 0;
    } catch {
      return false;
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBuildLock() {
  const start = Date.now();

  while (fileExists(lockFile)) {
    if (Date.now() - start > lockWaitTimeoutMs) {
      throw new Error(`Timed out waiting for build lock ${lockFile}`);
    }

    log('Detected build lock, waiting for active build to finish...');
    await sleep(lockPollMs);
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Command exited with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Command exited with code ${code}`));
        return;
      }

      resolve();
    });

    child.on('error', reject);
  });
}

async function ensureBuildReady() {
  await waitForBuildLock();

  if (hasValidBuild(buildDir)) {
    if (!hasValidBuild(standbyDir)) {
      copyDirectory(buildDir, standbyDir);
      log('Current build is valid; refreshed standby snapshot.');
    }
    return;
  }

  if (hasValidBuild(standbyDir)) {
    copyDirectory(standbyDir, buildDir);
    log('Recovered production build from standby snapshot.');
    return;
  }

  log('No valid build found. Running guarded build before start...');
  await runCommand(npmCommand, ['run', 'build']);

  if (!hasValidBuild(buildDir)) {
    throw new Error('Guarded build completed but .next is still incomplete.');
  }
}

function startNext() {
  log(`Starting Next production server on ${host}:${port}`);

  const child = spawn(nextBin, ['start', '-H', host, '-p', port], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    log(`Failed to launch next start: ${error.message}`);
    process.exit(1);
  });
}

ensureBuildReady()
  .then(startNext)
  .catch((error) => {
    log(`Startup guard failed: ${error.message}`);
    process.exit(1);
  });