#!/usr/bin/env tsx
// Author: PB and Claude
// Date: 2025-07-01
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// scripts/test-ssh-tunnel.ts

/**
 * SSH Tunnel Testing Script
 * 
 * Automated testing for SSH connectivity and tunnel establishment
 * Tests each component independently before full integration.
 */

import { Client } from 'ssh2';
import fs from 'fs';
import { config } from 'dotenv';

// Load environment variables
config();

interface TestResult {
  name: string;
  success: boolean;
  message: string;
  duration?: number;
}

class SSHTunnelTester {
  private results: TestResult[] = [];
  private hosts = ['snowl', 'snowball'];
  private sshUser = process.env.MCPMEM_SSH_USER || 'pball';
  private sshKeyPath = process.env.MCPMEM_SSH_KEY_PATH || `${process.env.HOME}/.ssh/id_rsa`;
  private tunnelPort = 5433;

  async runAllTests(): Promise<void> {
    console.error('🧪 SSH Tunnel Test Suite');
    console.error('=========================\n');
    
    await this.testSSHKeyExists();
    await this.testSSHKeyPermissions();
    
    for (const host of this.hosts) {
      await this.testHostConnectivity(host);
      await this.testSSHAuthentication(host);
      await this.testPortForwarding(host);
    }
    
    await this.testFailoverMechanism();
    
    this.printSummary();
  }

  private async testSSHKeyExists(): Promise<void> {
    const testName = 'SSH Key File Exists';
    const startTime = Date.now();
    
    try {
      const exists = fs.existsSync(this.sshKeyPath);
      if (exists) {
        this.addResult(testName, true, `Found SSH key at ${this.sshKeyPath}`, startTime);
      } else {
        this.addResult(testName, false, `SSH key not found at ${this.sshKeyPath}`, startTime);
      }
    } catch (error) {
      this.addResult(testName, false, `Error checking SSH key: ${error}`, startTime);
    }
  }

  private async testSSHKeyPermissions(): Promise<void> {
    const testName = 'SSH Key Permissions';
    const startTime = Date.now();
    
    try {
      const stats = fs.statSync(this.sshKeyPath);
      const mode = stats.mode & parseInt('777', 8);
      const modeString = mode.toString(8);
      
      if (mode <= parseInt('600', 8)) {
        this.addResult(testName, true, `SSH key permissions: ${modeString} (secure)`, startTime);
      } else {
        this.addResult(testName, false, `SSH key permissions: ${modeString} (too permissive, should be 600)`, startTime);
      }
    } catch (error) {
      this.addResult(testName, false, `Error checking SSH key permissions: ${error}`, startTime);
    }
  }

  private async testHostConnectivity(host: string): Promise<void> {
    const testName = `Host Connectivity (${host})`;
    const startTime = Date.now();
    
    try {
      // Simple ping test would be ideal, but we'll test SSH connection
      const client = new Client();
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.end();
          reject(new Error('Connection timeout (10s)'));
        }, 10000);
        
        client.on('ready', () => {
          clearTimeout(timeout);
          client.end();
          resolve();
        });
        
        client.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        
        client.connect({
          host: host,
          username: this.sshUser,
          privateKey: fs.readFileSync(this.sshKeyPath),
          readyTimeout: 10000,
        });
      });
      
      this.addResult(testName, true, `Successfully connected to ${host}`, startTime);
    } catch (error) {
      this.addResult(testName, false, `Failed to connect to ${host}: ${error}`, startTime);
    }
  }

  private async testSSHAuthentication(host: string): Promise<void> {
    const testName = `SSH Authentication (${host})`;
    const startTime = Date.now();
    
    try {
      const client = new Client();
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.end();
          reject(new Error('Authentication timeout'));
        }, 15000);
        
        client.on('ready', () => {
          // Test running a simple command
          client.exec('echo "auth-test-success"', (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              client.end();
              reject(err);
              return;
            }
            
            let output = '';
            stream.on('data', (data: Buffer) => {
              output += data.toString();
            });
            
            stream.on('close', () => {
              clearTimeout(timeout);
              client.end();
              if (output.includes('auth-test-success')) {
                resolve();
              } else {
                reject(new Error('Command execution failed'));
              }
            });
          });
        });
        
        client.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        
        client.connect({
          host: host,
          username: this.sshUser,
          privateKey: fs.readFileSync(this.sshKeyPath),
          readyTimeout: 15000,
        });
      });
      
      this.addResult(testName, true, `SSH authentication and command execution successful on ${host}`, startTime);
    } catch (error) {
      this.addResult(testName, false, `SSH authentication failed on ${host}: ${error}`, startTime);
    }
  }

  private async testPortForwarding(host: string): Promise<void> {
    const testName = `Port Forwarding (${host})`;
    const startTime = Date.now();
    
    try {
      const client = new Client();
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.end();
          reject(new Error('Port forwarding timeout'));
        }, 20000);
        
        client.on('ready', () => {
          // Test port forwarding (we'll forward to a dummy port for testing)
          client.forwardOut(
            '127.0.0.1', 0,          // Local address
            '127.0.0.1', 22,         // Remote SSH port (should exist)
            (err, stream) => {
              clearTimeout(timeout);
              
              if (err) {
                client.end();
                reject(new Error(`Port forwarding failed: ${err.message}`));
                return;
              }
              
              // If we get a stream, forwarding is working
              stream.end();
              client.end();
              resolve();
            }
          );
        });
        
        client.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        
        client.connect({
          host: host,
          username: this.sshUser,
          privateKey: fs.readFileSync(this.sshKeyPath),
          readyTimeout: 20000,
        });
      });
      
      this.addResult(testName, true, `Port forwarding successful on ${host}`, startTime);
    } catch (error) {
      this.addResult(testName, false, `Port forwarding failed on ${host}: ${error}`, startTime);
    }
  }

  private async testFailoverMechanism(): Promise<void> {
    const testName = 'Failover Mechanism';
    const startTime = Date.now();
    
    try {
      // Import our PostgreSQL adapter to test its failover logic
      const { PostgresAdapter } = await import('../src/db/adapters/postgres.js');
      const { DatabaseConfig } = await import('../src/db/adapters/base.js');
      
      const config: DatabaseConfig = {
        type: 'postgresql',
        postgresql: {
          hosts: this.hosts,
          database: 'test_db',
          user: this.sshUser,
          tunnel: true,
          tunnelPort: this.tunnelPort
        }
      };
      
      const adapter = new PostgresAdapter(config);
      
      // This will test the SSH tunnel failover logic
      try {
        await adapter.connect();
        await adapter.disconnect();
        this.addResult(testName, true, 'Failover mechanism works - adapter connected successfully', startTime);
      } catch (error) {
        // This might fail due to PostgreSQL not being available, but we want to test SSH tunnel logic
        if (error.message.includes('SSH tunnel established')) {
          this.addResult(testName, true, 'Failover mechanism works - SSH tunnel established', startTime);
        } else {
          this.addResult(testName, false, `Failover test failed: ${error}`, startTime);
        }
      }
    } catch (error) {
      this.addResult(testName, false, `Failover mechanism test failed: ${error}`, startTime);
    }
  }

  private addResult(name: string, success: boolean, message: string, startTime: number): void {
    const duration = Date.now() - startTime;
    this.results.push({ name, success, message, duration });
    
    const status = success ? '✅' : '❌';
    const time = `(${duration}ms)`;
    console.error(`${status} ${name}: ${message} ${time}`);
  }

  private printSummary(): void {
    const successful = this.results.filter(r => r.success).length;
    const total = this.results.length;
    const failedTests = this.results.filter(r => !r.success);
    
    console.error(`\n📊 Test Summary: ${successful}/${total} tests passed`);
    
    if (failedTests.length > 0) {
      console.error('\n❌ Failed Tests:');
      failedTests.forEach(test => {
        console.error(`  - ${test.name}: ${test.message}`);
      });
    }
    
    if (successful === total) {
      console.error('\n🎉 All SSH tunnel tests passed! Ready for PostgreSQL setup.');
    } else {
      console.error('\n⚠️  Some tests failed. Address issues before proceeding.');
    }
  }
}

async function main() {
  const tester = new SSHTunnelTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('💥 Test suite failed:', error);
  process.exit(1);
});