#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// scripts/test-all.ts

/**
 * Comprehensive Test Runner
 * 
 * Runs the complete test suite for the memory MCP server with PostgreSQL support.
 * Provides automated validation of all components before production use.
 */

import { config } from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';

// Load environment variables
config();

interface TestSuite {
  name: string;
  script: string;
  description: string;
  required: boolean;
}

class TestRunner {
  private testSuites: TestSuite[] = [
    {
      name: 'Hash Utility Tests',
      script: './scripts/test-hash-utils.ts',
      description: 'Unit tests for hash generation and formatting',
      required: false
    },
    {
      name: 'PostgreSQL Tests',
      script: './scripts/test-postgres.ts', 
      description: 'Test PostgreSQL connectivity and operations',
      required: true
    },
    {
      name: 'Phase 1 Extension Tests',
      script: './scripts/test-phase1-extensions.ts',
      description: 'Test smart memory automation tools (quick-store, recent-context, search-enhanced)',
      required: false
    }
  ];

  async runAllTests(): Promise<void> {
    console.error('🚀 Memory MCP Server - Complete Test Suite');
    console.error('===========================================\n');

    this.checkEnvironment();
    
    let allPassed = true;
    
    for (const suite of this.testSuites) {
      console.error(`\n🧪 Running ${suite.name}...`);
      console.error(`📝 ${suite.description}\n`);
      
      const success = await this.runTestSuite(suite);
      
      if (!success) {
        allPassed = false;
        if (suite.required) {
          console.error(`\n❌ Required test suite "${suite.name}" failed. Stopping execution.`);
          break;
        }
      }
      
      console.error(`\n${'='.repeat(50)}`);
    }
    
    this.printFinalSummary(allPassed);
  }

  private checkEnvironment(): void {
    console.error('🔍 Environment Check');
    console.error('===================');
    
    const requiredEnvVars = [
      'MCPMEM_DB_TYPE',
      'MCPMEM_PG_DATABASE', 
      'MCPMEM_PG_USER',
      'MCPMEM_PG_TUNNEL'
    ];
    
    const optionalEnvVars = [
      'MCPMEM_PG_HOSTS',
      'MCPMEM_PG_TUNNEL_PORT',
      'MCPMEM_SSH_USER',
      'MCPMEM_SSH_KEY_PATH'
    ];
    
    console.error('Required Environment Variables:');
    for (const envVar of requiredEnvVars) {
      const value = process.env[envVar];
      if (value) {
        console.error(`  ✅ ${envVar}=${value}`);
      } else {
        console.error(`  ❌ ${envVar} (not set - using default)`);
      }
    }
    
    console.error('\nOptional Environment Variables:');
    for (const envVar of optionalEnvVars) {
      const value = process.env[envVar];
      if (value) {
        console.error(`  ✅ ${envVar}=${value}`);
      } else {
        console.error(`  ⚪ ${envVar} (using default)`);
      }
    }
    
    // Check if we're in PostgreSQL mode
    if (process.env.MCPMEM_DB_TYPE !== 'postgresql') {
      console.error('\n⚠️  MCPMEM_DB_TYPE is not set to "postgresql"');
      console.error('   Set MCPMEM_DB_TYPE=postgresql to test PostgreSQL functionality');
      console.error('   Some tests may be skipped or fail.');
    }
  }

  private async runTestSuite(suite: TestSuite): Promise<boolean> {
    return new Promise((resolve) => {
      const scriptPath = path.resolve(suite.script);
      const child = spawn('npx', ['tsx', scriptPath], {
        stdio: 'inherit',
        env: process.env
      });
      
      child.on('close', (code) => {
        const success = code === 0;
        console.error(`\n${success ? '✅' : '❌'} ${suite.name} ${success ? 'PASSED' : 'FAILED'}`);
        resolve(success);
      });
      
      child.on('error', (error) => {
        console.error(`\n❌ ${suite.name} FAILED: ${error.message}`);
        resolve(false);
      });
    });
  }

  private printFinalSummary(allPassed: boolean): void {
    console.error('\n' + '='.repeat(60));
    console.error('🏁 Final Test Results');
    console.error('='.repeat(60));
    
    if (allPassed) {
      console.error('🎉 ALL TESTS PASSED!');
      console.error('');
      console.error('✅ Hash utilities working correctly');
      console.error('✅ PostgreSQL connectivity established');
      console.error('✅ Database operations functional');
      console.error('✅ Phase 1 Extensions (quick-store, recent-context, search-enhanced) working');
      console.error('✅ Vector similarity search operational');
      console.error('');
      console.error('🚀 The memory MCP server is ready for PostgreSQL production use!');
      console.error('');
      console.error('Next steps:');
      console.error('1. Run: npm run init:postgres (if not done already)');
      console.error('2. Start the server: MCPMEM_DB_TYPE=postgresql npm run dev');
      console.error('3. Test storing memories through the MCP interface');
    } else {
      console.error('❌ SOME TESTS FAILED');
      console.error('');
      console.error('Please review the test output above and address any issues.');
      console.error('Common issues:');
      console.error('- Database connection credentials');
      console.error('- Network connectivity to hosts');
      console.error('- PostgreSQL service not running');
      console.error('- pgvector extension not installed');
      console.error('- Database schema not initialized');
      console.error('');
      console.error('Run individual test suites for more detailed diagnosis:');
      console.error('- npm run test:postgres');
    }
    
    console.error('='.repeat(60));
  }
}

async function main() {
  const runner = new TestRunner();
  await runner.runAllTests();
}

main().catch(error => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});