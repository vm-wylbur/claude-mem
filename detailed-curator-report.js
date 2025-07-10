import { MultiAIAnalyzeMemoryQualityTool } from './src/tools/multi-ai-analyze-memory-quality.js';
import { DatabaseService } from './src/db/service.js';
import { createDatabaseAdapterToml } from './src/config.js';
import { config } from 'dotenv';

async function detailedCuratorReport() {
  console.log('🔍 Detailed Multi-AI Curator Analysis');
  console.log('='.repeat(50));
  
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const tool = new MultiAIAnalyzeMemoryQualityTool(dbService, true);
  const result = await tool.handle({ limit: 10, includeCodeCheck: true, codebaseRoot: '/home/pball/projects/claude-mem' });
  
  const report = JSON.parse(result.content[0].text);
  
  console.log(`\n📋 Analyzing ${report.analyses.length} memories in detail...\n`);
  
  for (const analysis of report.analyses) {
    console.log('='.repeat(60));
    console.log(`🗂️  MEMORY: ${analysis.memoryId}`);
    console.log(`📊 Quality Score: ${analysis.qualityScore}/100`);
    console.log(`⏱️  Processing Time: ${analysis.processingTimeMs}ms`);
    console.log('='.repeat(60));
    
    // Get memory content preview
    const memory = await dbService.getMemory(analysis.memoryId);
    if (memory) {
      console.log(`\n📄 CONTENT PREVIEW:`);
      console.log(`"${memory.content.substring(0, 150)}..."`);
      console.log(`\n📝 Type: ${memory.content_type}`);
    }
    
    console.log(`\n🤖 AGENT ANALYSES (${analysis.agentAnalyses.length} agents):`);
    for (const agent of analysis.agentAnalyses) {
      console.log(`\n  👤 ${agent.agentRole.toUpperCase()}`);
      console.log(`     Confidence: ${(agent.confidenceScore * 100).toFixed(1)}%`);
      console.log(`     Relevance: ${(agent.relevanceScore * 100).toFixed(1)}%`);
      console.log(`     Recommendation: ${agent.deleteRecommendation ? '🗑️  DELETE' : '✅ KEEP'}`);
      
      if (agent.reasoning) {
        console.log(`     Reasoning: ${agent.reasoning}`);
      }
      
      if (agent.findings && agent.findings.length > 0) {
        console.log(`     Findings:`);
        for (const finding of agent.findings) {
          console.log(`       - [${finding.severity.toUpperCase()}] ${finding.description}`);
        }
      }
      
      if (agent.specializedInsights && agent.specializedInsights.length > 0) {
        console.log(`     Insights:`);
        for (const insight of agent.specializedInsights) {
          console.log(`       • ${insight}`);
        }
      }
    }
    
    console.log(`\n🎯 CONSENSUS RESULT:`);
    console.log(`   Final Decision: ${analysis.consensus.finalDecision ? '🗑️  DELETE' : '✅ KEEP'}`);
    console.log(`   Consensus Confidence: ${(analysis.consensus.consensusConfidence * 100).toFixed(1)}%`);
    console.log(`   Agreement Level: ${(analysis.consensus.agreementLevel * 100).toFixed(1)}%`);
    console.log(`   Human Review: ${analysis.consensus.requiresHumanReview ? '⚠️  REQUIRED' : '✅ NOT NEEDED'}`);
    
    if (analysis.consensus.minorityViews && analysis.consensus.minorityViews.length > 0) {
      console.log(`   Minority Views:`);
      for (const view of analysis.consensus.minorityViews) {
        console.log(`     - ${view}`);
      }
    }
    
    if (analysis.issues && analysis.issues.length > 0) {
      console.log(`\n🚨 QUALITY ISSUES (${analysis.issues.length}):`);
      for (const issue of analysis.issues) {
        console.log(`   - [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}`);
        if (issue.suggestion) {
          console.log(`     💡 Suggestion: ${issue.suggestion}`);
        }
      }
    } else {
      console.log(`\n✅ NO QUALITY ISSUES DETECTED`);
    }
    
    console.log('\n');
  }
  
  console.log('🎯 SUMMARY OF RECOMMENDATIONS:');
  const keepCount = report.analyses.filter(a => !a.consensus.finalDecision).length;
  const deleteCount = report.analyses.filter(a => a.consensus.finalDecision).length;
  const humanReviewCount = report.analyses.filter(a => a.consensus.requiresHumanReview).length;
  
  console.log(`✅ Keep: ${keepCount}`);
  console.log(`🗑️  Delete: ${deleteCount}`);
  console.log(`⚠️  Human Review: ${humanReviewCount}`);
  
  console.log('\n✅ Detailed Analysis Complete');
}

detailedCuratorReport().catch(console.error);