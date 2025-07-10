import { MultiAIAnalyzeMemoryQualityTool } from './src/tools/multi-ai-analyze-memory-quality.js';
import { DatabaseService } from './src/db/service.js';
import { createDatabaseAdapterToml } from './src/config.js';
import { config } from 'dotenv';

async function runCuratorReport() {
  console.log('🎯 Multi-AI Memory Curator Report for claude-mem');
  console.log('='.repeat(60));
  
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const tool = new MultiAIAnalyzeMemoryQualityTool(dbService, true);
  const result = await tool.handle({ limit: 30, includeCodeCheck: true, codebaseRoot: '/home/pball/projects/claude-mem' });
  
  const report = JSON.parse(result.content[0].text);
  
  console.log('\n📊 EXECUTIVE SUMMARY');
  console.log('-'.repeat(30));
  console.log(`Memories Analyzed: ${report.summary.memoriesAnalyzed}`);
  console.log(`Avg Processing Time: ${report.summary.averageProcessingTimeMs}ms`);
  console.log(`Consensus Confidence: ${(report.summary.multiAIConsensusStats.averageConsensusConfidence * 100).toFixed(1)}%`);
  console.log(`Agreement Level: ${(report.summary.multiAIConsensusStats.averageAgreementLevel * 100).toFixed(1)}%`);
  console.log(`Human Review Required: ${report.summary.multiAIConsensusStats.humanReviewRequired}`);
  
  console.log('\n🔍 TOP FINDINGS');
  console.log('-'.repeat(30));
  let totalIssues = 0;
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  
  for (const analysis of report.analyses.slice(0, 10)) {
    if (analysis.issues.length > 0) {
      console.log(`\nMemory: ${analysis.memoryId.substring(0, 8)}...`);
      console.log(`Quality Score: ${analysis.qualityScore}`);
      console.log(`Issues Found: ${analysis.issues.length}`);
      
      for (const issue of analysis.issues) {
        console.log(`  - [${issue.severity.toUpperCase()}] ${issue.description}`);
        severityCounts[issue.severity]++;
        totalIssues++;
      }
    }
  }
  
  console.log('\n📈 ISSUE BREAKDOWN');
  console.log('-'.repeat(30));
  console.log(`Total Issues: ${totalIssues}`);
  console.log(`Critical: ${severityCounts.critical}`);
  console.log(`High: ${severityCounts.high}`);
  console.log(`Medium: ${severityCounts.medium}`);
  console.log(`Low: ${severityCounts.low}`);
  
  console.log('\n🤖 AGENT PERFORMANCE');
  console.log('-'.repeat(30));
  const agentStats = {};
  for (const analysis of report.analyses) {
    for (const agent of analysis.agentAnalyses) {
      if (!agentStats[agent.agentRole]) {
        agentStats[agent.agentRole] = { count: 0, totalConfidence: 0, totalRelevance: 0 };
      }
      agentStats[agent.agentRole].count++;
      agentStats[agent.agentRole].totalConfidence += agent.confidenceScore;
      agentStats[agent.agentRole].totalRelevance += agent.relevanceScore;
    }
  }
  
  for (const [agent, stats] of Object.entries(agentStats)) {
    const avgConfidence = (stats.totalConfidence / stats.count * 100).toFixed(1);
    const avgRelevance = (stats.totalRelevance / stats.count * 100).toFixed(1);
    console.log(`${agent}: ${stats.count} analyses, ${avgConfidence}% confidence, ${avgRelevance}% relevance`);
  }
  
  console.log('\n✅ Analysis Complete');
}

runCuratorReport().catch(console.error);