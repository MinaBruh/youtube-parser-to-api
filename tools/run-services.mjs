import { spawn } from 'node:child_process';
import readline from 'node:readline';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const workspaceConfigs = {
  shared: {
    label: 'shared',
    workspace: '@ytpa/shared',
    scripts: {
      dev: 'dev',
    },
  },
  api: {
    label: 'api',
    workspace: '@ytpa/api',
    scripts: {
      dev: 'dev',
      start: 'start',
    },
  },
  media: {
    label: 'media',
    workspace: '@ytpa/media',
    scripts: {
      dev: 'dev',
      start: 'start',
    },
  },
  web: {
    label: 'web',
    workspace: '@ytpa/web',
    scripts: {
      dev: 'dev',
      start: 'start',
    },
  },
};

const colorCodes = {
  shared: '\u001b[36m',
  api: '\u001b[31m',
  media: '\u001b[33m',
  web: '\u001b[35m',
  reset: '\u001b[0m',
};

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node tools/run-services.mjs <dev|start> [--with-cache] [--cache-url redis://127.0.0.1:6379] <targets...>');
  process.exit(1);
}

const mode = args.shift();
if (mode !== 'dev' && mode !== 'start') {
  console.error(`Unsupported mode "${mode}". Expected "dev" or "start".`);
  process.exit(1);
}

let withCache = false;
let cacheUrl = 'redis://127.0.0.1:6379';
const targets = [];

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];

  if (value === '--with-cache') {
    withCache = true;
    continue;
  }

  if (value === '--cache-url') {
    const nextValue = args[index + 1];
    if (!nextValue) {
      console.error('Expected a URL after --cache-url.');
      process.exit(1);
    }

    cacheUrl = nextValue;
    withCache = true;
    index += 1;
    continue;
  }

  targets.push(value);
}

if (targets.length === 0) {
  console.error('Expected at least one target: shared, api, media or web.');
  process.exit(1);
}

for (const target of targets) {
  if (!(target in workspaceConfigs)) {
    console.error(`Unknown target "${target}". Expected one of: ${Object.keys(workspaceConfigs).join(', ')}.`);
    process.exit(1);
  }
}

if (mode === 'start' && targets.includes('shared')) {
  console.error('The shared package does not have a start script. Use it only in dev mode.');
  process.exit(1);
}

const shouldPrebuildShared = mode === 'dev' && targets.some((target) => target === 'shared' || target === 'api' || target === 'media');

const baseEnv = {
  ...process.env,
};

if (withCache) {
  baseEnv.VALKEY_URL = baseEnv.VALKEY_URL || cacheUrl;
  baseEnv.YTPA_REDIS_URL = baseEnv.YTPA_REDIS_URL || cacheUrl;
}

const quoteForCmd = (value) => {
  if (!/[\s"^&|<>()]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
};

const spawnProcess = (command, commandArgs, options) => {
  if (process.platform === 'win32') {
    const fullCommand = [command, ...commandArgs].map(quoteForCmd).join(' ');
    return spawn('cmd.exe', ['/d', '/s', '/c', fullCommand], {
      ...options,
      shell: false,
    });
  }

  return spawn(command, commandArgs, {
    ...options,
    shell: false,
  });
};

const terminateChild = (child) => {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      shell: false,
    });

    killer.on('error', () => {
      child.kill('SIGTERM');
    });

    return;
  }

  child.kill('SIGTERM');
};

const prefixOutput = (stream, label) => {
  if (!stream) {
    return;
  }

  const color = colorCodes[label] ?? '';
  const prefix = `${color}[${label}]${colorCodes.reset} `;

  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  reader.on('line', (line) => {
    console.log(`${prefix}${line}`);
  });
};

const runCommand = (command, commandArgs, env) => {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, commandArgs, {
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${commandArgs.join(' ')} terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
};

const createWorkspaceArgs = (target) => {
  const config = workspaceConfigs[target];
  const script = config.scripts[mode];

  if (!script) {
    throw new Error(`Target "${target}" does not support mode "${mode}".`);
  }

  return ['run', script, '--workspace', config.workspace];
};

const childProcesses = new Set();
let shuttingDown = false;

const stopAll = () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of childProcesses) {
    terminateChild(child);
  }
};

process.on('SIGINT', () => {
  stopAll();
});

process.on('SIGTERM', () => {
  stopAll();
});

if (shouldPrebuildShared) {
  console.log('[runner] prebuilding shared workspace before starting watchers...');
  await runCommand(npmCommand, ['run', 'build', '--workspace', '@ytpa/shared'], baseEnv);
}

const spawnWorkspace = (target) => {
  const config = workspaceConfigs[target];
  const useInheritedStdio = process.platform === 'win32';
  const child = spawnProcess(npmCommand, createWorkspaceArgs(target), {
    env: baseEnv,
    stdio: useInheritedStdio ? 'inherit' : ['inherit', 'pipe', 'pipe'],
  });

  childProcesses.add(child);
  if (!useInheritedStdio) {
    prefixOutput(child.stdout, config.label);
    prefixOutput(child.stderr, config.label);
  }

  child.on('exit', (code, signal) => {
    childProcesses.delete(child);

    if (shuttingDown) {
      return;
    }

    if (signal) {
      console.error(`[runner] ${config.label} exited because of signal ${signal}.`);
      stopAll();
      process.exit(1);
      return;
    }

    if (code !== 0) {
      console.error(`[runner] ${config.label} exited with code ${code}.`);
      stopAll();
      process.exit(code ?? 1);
    }
  });
};

console.log(`[runner] starting mode=${mode}, targets=${targets.join(', ')}, cache=${withCache ? baseEnv.VALKEY_URL : 'disabled'}`);
for (const target of targets) {
  spawnWorkspace(target);
}
