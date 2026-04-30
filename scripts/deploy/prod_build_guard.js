#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '../..');
const buildDir = path.join(workspaceRoot, '.next');
const standbyDir = path.join(workspaceRoot, '.next-standby');
const lockFile = path.join(workspaceRoot, '.next-build.lock');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const requiredBuildFiles = [
  'BUILD_ID',
  'routes-manifest.json',
  'prerender-manifest.json',
  path.join('server', 'app-paths-manifest.json'),
];

function log(message) {
  const time = new Date().toISOString().replace('T', ' ').replace('Z', '');
  console.log(`[prod-build ${time}] ${message}`);
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

function acquireLock() {
  try {
    const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2);
    fs.writeFileSync(lockFile, payload, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return false;
    }

    throw error;
  }
}

function releaseLock() {
  ensureRemoved(lockFile);
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

async function main() {
  if (!acquireLock()) {
    log('Build lock already exists. Another build is in progress.');
    process.exit(2);
  }

  try {
    log('Starting guarded production build...');
    await runCommand(npmCommand, ['run', 'build:next']);

    if (!hasValidBuild(buildDir)) {
      throw new Error('Build finished but required .next artifacts are incomplete.');
    }

    copyDirectory(buildDir, standbyDir);
    log('Build completed and standby snapshot refreshed.');
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  log(`Build failed: ${error.message}`);
  process.exit(1);
});