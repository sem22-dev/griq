#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { TunnelClient } from './client';
import express from 'express';
import path from 'path';
import fs from 'fs';

// Load config
const CONFIG_DIR = `${process.env.HOME || process.env.USERPROFILE}/.griq`;
const CONFIG_FILE = `${CONFIG_DIR}/config.json`;
let DEFAULT_SERVER = 'wss://griq.site/';

try {
  if (fs.existsSync(CONFIG_FILE)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    DEFAULT_SERVER = config.server_url || DEFAULT_SERVER;
  }
} catch (error) {
  console.warn(chalk.yellow('Warning: Could not load config file, using default server URL'));
}

const program = new Command();
program
  .name('griq')
  .description('Griq: Expose your localhost to the internet')
  .version('1.0.0');

program
  .command('http <port>')
  .description('Expose a local HTTP server to the internet')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain')
  .option('-u, --url <url>', 'Tunnel server URL (overrides config)', DEFAULT_SERVER)
  .action(async (port, options) => {
    const spinner = ora('Connecting to tunnel server...').start();
    
    try {
      const portNumber = parseInt(port, 10);
      if (isNaN(portNumber)) {
        spinner.fail('Invalid port number');
        process.exit(1);
      }
      
      const client = new TunnelClient(options.url, portNumber, options.subdomain);
      
      client.on('error', (error) => {
        spinner.fail(`Error: ${error.message}`);
        process.exit(1);
      });
      
      client.on('registered', (url) => {
        spinner.succeed(`Tunnel established!`);
        console.log(`\n${chalk.green('✓')} Local server: ${chalk.cyan(`http://localhost:${port}`)}`);
        console.log(`${chalk.green('✓')} Public URL:   ${chalk.cyan(url)}`);
        console.log(`\n${chalk.yellow('Press Ctrl+C to stop')}`);
      });
      
      process.on('SIGINT', () => {
        console.log('\nShutting down tunnel...');
        client.close();
        process.exit(0);
      });
    } catch (error: any) {
      spinner.fail(`Failed to start tunnel: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('serve [directory]')
  .description('Serve a directory and expose it to the internet')
  .option('-p, --port <port>', 'Port to use for the local server', '8000')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain')
  .option('-u, --url <url>', 'Tunnel server URL (overrides config)', DEFAULT_SERVER)
  .action(async (directory = '.', options) => {
    const spinner = ora('Starting local server...').start();
    
    try {
      const portNumber = parseInt(options.port, 10);
      if (isNaN(portNumber)) {
        spinner.fail('Invalid port number');
        process.exit(1);
      }
      
      const dirPath = path.resolve(process.cwd(), directory);
      if (!fs.existsSync(dirPath)) {
        spinner.fail(`Directory not found: ${dirPath}`);
        process.exit(1);
      }
      
      const app = express();
      app.use(express.static(dirPath));
      
      const server = app.listen(portNumber, () => {
        spinner.succeed(`Local server started on port ${portNumber}`);
        spinner.start('Connecting to tunnel server...');
        
        const client = new TunnelClient(options.url, portNumber, options.subdomain);
        
        client.on('error', (error) => {
          spinner.fail(`Error: ${error.message}`);
          server.close();
          process.exit(1);
        });
        
        client.on('registered', (url) => {
          spinner.succeed(`Tunnel established!`);
          console.log(`\n${chalk.green('✓')} Serving: ${chalk.cyan(dirPath)}`);
          console.log(`${chalk.green('✓')} Local URL: ${chalk.cyan(`http://localhost:${portNumber}`)}`);
          console.log(`${chalk.green('✓')} Public URL: ${chalk.cyan(url)}`);
          console.log(`\n${chalk.yellow('Press Ctrl+C to stop')}`);
        });
        
        process.on('SIGINT', () => {
          console.log('\nShutting down server and tunnel...');
          client.close();
          server.close();
          process.exit(0);
        });
      });
    } catch (error: any) {
      spinner.fail(`Failed to start server: ${error.message}`);
      process.exit(1);
    }
  });

// Add config command to set default server URL
program
  .command('config')
  .description('Manage Griq configuration')
  .option('-s, --server <url>', 'Set default server URL')
  .action(async (options) => {
    if (options.server) {
      try {
        // Ensure config directory exists
        if (!fs.existsSync(CONFIG_DIR)) {
          fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        
        // Read existing config or create new one
        let config: any = {};
        if (fs.existsSync(CONFIG_FILE)) {
          config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
        
        // Update server URL
        config.server_url = options.server;
        
        // Write config back to file
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log(chalk.green(`Default server URL set to: ${options.server}`));
      } catch (error: any) {
        console.error(chalk.red(`Failed to update config: ${error.message}`));
        process.exit(1);
      }
    } else {
      // Display current config
      try {
        if (fs.existsSync(CONFIG_FILE)) {
          const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
          console.log(chalk.cyan('Current configuration:'));
          console.log(JSON.stringify(config, null, 2));
        } else {
          console.log(chalk.yellow('No configuration file found. Using default settings.'));
          console.log(chalk.cyan(`Default server URL: ${DEFAULT_SERVER}`));
        }
      } catch (error: any) {
        console.error(chalk.red(`Failed to read config: ${error.message}`));
      }
    }
  });

program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}