#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { cac } from 'cac';
import pc from 'picocolors';
import { startServer } from './server.js';
import { runCheckCommand } from './commands/check.js';
import { runBuildCommand } from './commands/build.js';
import { runInitCommand } from './commands/init.js';

const cli = cac('featherduster');

// 1. Default command: launch local server
cli
  .command('[root]', 'Launch local Featherduster server and web UI')
  .option('-p, --port <port>', 'Port to bind server on (default: 4173)', { default: 4173 })
  .option('--no-open', 'Do not open web browser automatically')
  .action(async (root?: string, options: { port?: number | string; open?: boolean } = {}) => {
    const workspaceDir = root || process.cwd();
    const port = Number(options.port) || 4173;
    const openBrowser = options.open !== false;

    console.log(pc.bold(pc.cyan('\nStarting Featherduster Local Server...')));
    console.log(pc.gray(`Workspace: ${workspaceDir}`));
    console.log(pc.gray(`Address:   http://127.0.0.1:${port}`));

    try {
      const serverInstance = await startServer({
        workspaceDir,
        port,
        openBrowser,
      });
      console.log(pc.green(`✔ Server listening on http://127.0.0.1:${port}\n`));

      const handleShutdown = async () => {
        console.log(pc.yellow('\nShutting down Featherduster server...'));
        try {
          await serverInstance.close();
        } catch {}
        process.exit(0);
      };

      process.on('SIGINT', handleShutdown);
      process.on('SIGTERM', handleShutdown);
    } catch (err: any) {
      console.error(pc.red(`Failed to start server: ${err.message}`));
      process.exit(1);
    }
  });

// 2. Check command: headless integrity linter
cli
  .command('check [root]', 'Run headless integrity check on citations and metrics')
  .option('--strict', 'Fail on provisional evidence citations as well as hard violations')
  .action(async (root?: string, options: { strict?: boolean } = {}) => {
    const workspace = root || process.cwd();
    await runCheckCommand({ workspace, exitOnError: true, strict: options.strict });
  });

// 3. Build command: headless resume and brag doc compiler
cli
  .command('build [target]', 'Compile tailored resume or performance brag doc')
  .option('-w, --workspace <dir>', 'Path to workspace directory')
  .option('-f, --format <format>', 'Export format: markdown | html | brag | typst | latex', {
    default: 'markdown',
  })
  .option('-s, --spec <file>', 'Path to resume spec or rubric file')
  .option('-r, --rubric <id>', 'Rubric ID for brag doc compilation')
  .option('-o, --output <file>', 'Output destination path')
  .option('--stdout', 'Stream compiled output directly to stdout')
  .option('--strict', 'Fail build with error code if banned keywords are detected')
  .action(async (target?: string, options: any = {}) => {
    let workspace = options.workspace || process.cwd();
    let spec = options.spec;

    if (target) {
      const resolved = path.resolve(target);
      if (fs.existsSync(resolved)) {
        if (fs.statSync(resolved).isDirectory()) {
          workspace = resolved;
        } else if (fs.statSync(resolved).isFile()) {
          spec = resolved;
          if (!options.workspace) {
            const candidate = path.dirname(path.dirname(resolved));
            if (fs.existsSync(path.join(candidate, '.featherduster'))) {
              workspace = candidate;
            } else {
              workspace = path.dirname(resolved);
            }
          }
        }
      } else {
        const candidateSpecYaml = path.join(workspace, 'resumes', 'tailored', `${target}.yaml`);
        const candidateSpecJson = path.join(workspace, 'resumes', 'tailored', `${target}.json`);
        if (fs.existsSync(candidateSpecYaml)) {
          spec = candidateSpecYaml;
        } else if (fs.existsSync(candidateSpecJson)) {
          spec = candidateSpecJson;
        }
      }
    }

    await runBuildCommand({
      workspace,
      format: options.format,
      spec,
      rubric: options.rubric,
      output: options.output,
      stdout: options.stdout,
      strict: Boolean(options.strict),
    });
  });

// 4. Init command: scaffold new career workspace
cli
  .command('init [root]', 'Initialize a new Featherduster career corpus workspace')
  .option('-f, --force', 'Overwrite existing files if present')
  .option('--block-push', 'Configure pre-push hook to unconditionally block remote pushes')
  .action(async (root?: string, options: { force?: boolean; blockPush?: boolean } = {}) => {
    await runInitCommand({
      workspace: root || process.cwd(),
      force: options.force,
      blockPush: options.blockPush,
    });
  });

cli.help();
cli.version('0.1.0');
cli.parse();
