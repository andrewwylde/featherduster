#!/usr/bin/env node
import { cac } from 'cac';
import pc from 'picocolors';
import { startServer } from './server.js';
import { runCheckCommand } from './commands/check.js';
import { runBuildCommand } from './commands/build.js';

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
      await startServer({
        workspaceDir,
        port,
        openBrowser,
      });
      console.log(pc.green(`✔ Server listening on http://127.0.0.1:${port}\n`));
    } catch (err: any) {
      console.error(pc.red(`Failed to start server: ${err.message}`));
      process.exit(1);
    }
  });

// 2. Check command: headless integrity linter
cli
  .command('check [root]', 'Run headless integrity check on citations and metrics')
  .action(async (root?: string) => {
    const workspace = root || process.cwd();
    await runCheckCommand({ workspace, exitOnError: true });
  });

// 3. Build command: headless resume and brag doc compiler
cli
  .command('build [variant]', 'Compile tailored resume or performance brag doc')
  .option('-f, --format <format>', 'Export format: markdown | html | brag | typst | latex', {
    default: 'markdown',
  })
  .option('-s, --spec <file>', 'Path to resume spec or rubric file')
  .option('-r, --rubric <id>', 'Rubric ID for brag doc compilation')
  .option('-o, --output <file>', 'Output destination path')
  .option('--stdout', 'Stream compiled output directly to stdout')
  .action(async (_variant?: string, options: any = {}) => {
    await runBuildCommand({
      workspace: process.cwd(),
      format: options.format,
      spec: options.spec,
      rubric: options.rubric,
      output: options.output,
      stdout: options.stdout,
    });
  });

cli.help();
cli.version('0.1.0');
cli.parse();
