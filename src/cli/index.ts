/**
 * WSF CLI
 *
 * Implements ADR-WSF-24 §7.4 (CLI). Provides batch operations
 * for the WSF Semantic Engine.
 *
 * Usage:
 *   wsf concept get <semantic_id>
 *   wsf concept list [--tier=Tier1]
 *   wsf assertion submit <file.json>
 *   wsf validate <file.json>
 *   wsf query <expression>
 *   wsf resolve <curie>
 */

import { readFileSync } from 'node:fs';
import { createServices, type ServiceContainer } from '../services/index.js';
import { MemoryStore } from '../store/StoreLayer.js';
import type {
  Concept,
  Assertion,
  CURIE,
  Representation,
  ValidationRequest,
  Query,
  IdentifierResolution,
} from '../types/index.js';

// ============================================================================
// CLI Commands
// ============================================================================

export interface CLICommand {
  name: string;
  description: string;
  execute(args: string[]): Promise<number>;
}

export class WSFCmd {
  private services: ServiceContainer;

  constructor() {
    this.services = createServices(new MemoryStore());
  }

  /**
   * Parse command and route to handler.
   */
  async run(args: string[]): Promise<number> {
    if (args.length === 0) {
      this.printUsage();
      return 0;
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    switch (command) {
      case 'concept':
        return this.handleConcept(commandArgs);
      case 'assertion':
        return this.handleAssertion(commandArgs);
      case 'validate':
        return this.handleValidate(commandArgs);
      case 'query':
        return this.handleQuery(commandArgs);
      case 'resolve':
        return this.handleResolve(commandArgs);
      case 'help':
      case '--help':
      case '-h':
        this.printUsage();
        return 0;
      default:
        console.error(`Unknown command: ${command}`);
        this.printUsage();
        return 1;
    }
  }

  private async handleConcept(args: string[]): Promise<number> {
    const subcommand = args[0];
    if (subcommand === 'get') {
      const semantic_id = args[1] as CURIE;
      if (!semantic_id) {
        console.error('Usage: wsf concept get <semantic_id>');
        return 1;
      }
      const result = await this.services.concept.get(semantic_id);
      if (!result.success) {
        console.error(`Error: ${result.error?.message}`);
        return 1;
      }
      console.log(JSON.stringify(result.data, null, 2));
      return 0;
    } else if (subcommand === 'list') {
      const tierArg = args.find(a => a.startsWith('--tier='));
      const tier = tierArg ? tierArg.split('=')[1] as 'Tier 1' | 'Tier 2' | 'Tier 3' : undefined;
      const result = await this.services.concept.list(tier);
      if (!result.success) {
        console.error(`Error: ${result.error?.message}`);
        return 1;
      }
      console.log(JSON.stringify(result.data, null, 2));
      return 0;
    } else {
      console.error('Usage: wsf concept [get|list]');
      return 1;
    }
  }

  private async handleAssertion(args: string[]): Promise<number> {
    const subcommand = args[0];
    if (subcommand === 'submit') {
      const file = args[1];
      if (!file) {
        console.error('Usage: wsf assertion submit <file.json>');
        return 1;
      }
      const content = readFileSync(file, 'utf-8');
      const assertion = JSON.parse(content) as Assertion;
      const result = await this.services.assertion.submit(assertion);
      if (!result.success) {
        console.error(`Error: ${result.error?.message}`);
        return 1;
      }
      console.log(JSON.stringify(result.data, null, 2));
      return 0;
    } else {
      console.error('Usage: wsf assertion submit <file.json>');
      return 1;
    }
  }

  private async handleValidate(args: string[]): Promise<number> {
    const file = args[0];
    if (!file) {
      console.error('Usage: wsf validate <file.json>');
      return 1;
    }
    const content = readFileSync(file, 'utf-8');
    const representation = JSON.parse(content) as Representation;
    const request: ValidationRequest = {
      representations: [representation],
      language: 'shacl',
    };
    const result = await this.services.validation.validate(request);
    if (!result.success) {
      console.error(`Error: ${result.error?.message}`);
      return 1;
    }
    console.log(JSON.stringify(result.data, null, 2));
    return result.data?.conforms ? 0 : 1;
  }

  private async handleQuery(args: string[]): Promise<number> {
    const expression = args[0];
    if (!expression) {
      console.error('Usage: wsf query <expression>');
      return 1;
    }
    const query: Query = {
      type: 'pattern',
      expression,
      parameters: { pattern: expression },
    };
    const result = await this.services.query.execute(query);
    if (!result.success) {
      console.error(`Error: ${result.error?.message}`);
      return 1;
    }
    console.log(JSON.stringify(result.data, null, 2));
    return 0;
  }

  private async handleResolve(args: string[]): Promise<number> {
    const curie = args[0] as CURIE;
    if (!curie) {
      console.error('Usage: wsf resolve <curie>');
      return 1;
    }
    const resolution: IdentifierResolution = { curie, strategy: 'exact' };
    const result = await this.services.identity.resolveIdentifier(resolution);
    if (!result.success) {
      console.error(`Error: ${result.error?.message}`);
      return 1;
    }
    console.log(JSON.stringify(result.data, null, 2));
    return 0;
  }

  private printUsage(): void {
    console.log(`
WSF CLI : World Semantic Foundation Semantic Engine

Usage:
  wsf concept get <semantic_id>             Retrieve a concept
  wsf concept list [--tier=Tier1]           List concepts (optionally filtered)
  wsf assertion submit <file.json>          Submit an assertion from file
  wsf validate <file.json>                  Validate a representation
  wsf query <expression>                    Execute a pattern query
  wsf resolve <curie>                       Resolve a CURIE identifier
  wsf help                                  Show this help

Examples:
  wsf concept get wsf:Entity
  wsf concept list --tier=Tier2
  wsf assertion submit my_assertion.json
  wsf resolve wsf:Entity
`);
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

/**
 * CLI entry point. Parse process.argv and dispatch to handler.
 */
export async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const cmd = new WSFCmd();
  return cmd.run(args);
}

// Auto-execute when run directly
if (typeof require !== 'undefined' && require.main === module) {
  main().then(code => process.exit(code)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}