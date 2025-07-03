#!/usr/bin/env node
// Generate build info at build time
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function generateBuildInfo() {
  const timestamp = new Date().toISOString();
  const packageJson = require('../package.json');
  
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.warn('Could not get git commit hash:', error.message);
  }
  
  let gitBranch = 'unknown';
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.warn('Could not get git branch:', error.message);
  }
  
  const buildInfo = {
    timestamp,
    version: packageJson.version,
    gitCommit,
    gitBranch,
    nodeVersion: process.version,
    builtBy: 'npm run build'
  };
  
  const buildInfoCode = `// Auto-generated at build time - do not edit manually
export const buildInfo = ${JSON.stringify(buildInfo, null, 2)};
`;
  
  const outputPath = path.join(__dirname, '../src/buildInfo.ts');
  fs.writeFileSync(outputPath, buildInfoCode);
  
  console.log(`✅ Generated build info: ${timestamp}`);
  console.log(`   Version: ${buildInfo.version}`);
  console.log(`   Git: ${buildInfo.gitCommit} (${buildInfo.gitBranch})`);
}

generateBuildInfo();