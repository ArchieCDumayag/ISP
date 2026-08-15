#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.join(__dirname, 'ai_coord.py');
const forwardedArgs = process.argv.slice(2);
const launch = process.platform === 'win32'
    ? { command: 'py', args: ['-3'] }
    : { command: 'python3', args: [] };

const result = spawnSync(
    launch.command,
    [...launch.args, scriptPath, ...forwardedArgs],
    { stdio: 'inherit' }
);

if (result.error) {
    const platformHint = process.platform === 'win32'
        ? 'Install Python with the Windows py launcher enabled.'
        : 'Install Python 3 and ensure python3 is available on PATH.';
    console.error(`Unable to start the coordination tool. ${platformHint}`);
    process.exit(1);
}

process.exit(Number.isInteger(result.status) ? result.status : 1);
