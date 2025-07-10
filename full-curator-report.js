import { MultiAIAnalyzeMemoryQualityTool } from './dist/tools/multi-ai-analyze-memory-quality.js';
import { DatabaseService } from './dist/db/service.js';
import { createDatabaseAdapterToml } from './dist/config.js';
import { config } from 'dotenv';

async function fullCuratorReport() {
  console.log('🔍 FULL COLLECTION Multi-AI Curator Analysis');
  console.log('='.repeat(60));
  
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const tool = new MultiAIAnalyzeMemoryQualityTool(dbService, true);
  
  console.log('🚀 Starting analysis of full memory collection...');
  const startTime = Date.now();
  
  // Analyze all memories 
  const result = await tool.handle({ 
    limit: 217,  // Get all memories
    includeCodeCheck: true, 
    codebaseRoot: '/home/pball/projects/claude-mem' 
  });
  
  const totalTime = Date.now() - startTime;
  const report = JSON.parse(result.content[0].text);
  
  console.log(`\n📊 FULL COLLECTION EXECUTIVE SUMMARY`);
  console.log('='.repeat(50));
  console.log(`Total Memories Analyzed: ${report.summary.memoriesAnalyzed}`);
  console.log(`Total Processing Time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`Average Per Memory: ${report.summary.averageProcessingTimeMs}ms`);
  console.log(`Consensus Confidence: ${(report.summary.multiAIConsensusStats.averageConsensusConfidence * 100).toFixed(1)}%`);
  console.log(`Agent Agreement: ${(report.summary.multiAIConsensusStats.averageAgreementLevel * 100).toFixed(1)}%`);
  console.log(`Human Review Required: ${report.summary.multiAIConsensusStats.humanReviewRequired}`);
  console.log(`Unanimous Decisions: ${report.summary.multiAIConsensusStats.unanimousDecisions}`);
  
  // Analyze recommendations
  const keepCount = report.analyses.filter(a => !a.consensus.finalDecision).length;
  const deleteCount = report.analyses.filter(a => a.consensus.finalDecision).length;
  const humanReviewCount = report.analyses.filter(a => a.consensus.requiresHumanReview).length;
  
  console.log(`\n🎯 COLLECTION-WIDE RECOMMENDATIONS`);
  console.log('='.repeat(40));
  console.log(`✅ Keep: ${keepCount} (${(keepCount/report.analyses.length*100).toFixed(1)}%)`);
  console.log(`🗑️  Delete: ${deleteCount} (${(deleteCount/report.analyses.length*100).toFixed(1)}%)`);
  console.log(`⚠️  Human Review: ${humanReviewCount} (${(humanReviewCount/report.analyses.length*100).toFixed(1)}%)`);
  
  // Quality score distribution
  const qualityScores = report.analyses.map(a => a.qualityScore);
  const avgQuality = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
  const highQuality = qualityScores.filter(s => s >= 80).length;
  const mediumQuality = qualityScores.filter(s => s >= 60 && s < 80).length;
  const lowQuality = qualityScores.filter(s => s < 60).length;
  
  console.log(`\n📈 QUALITY SCORE DISTRIBUTION`);
  console.log('='.repeat(35));
  console.log(`Average Quality: ${avgQuality.toFixed(1)}/100`);
  console.log(`High Quality (80+): ${highQuality} (${(highQuality/report.analyses.length*100).toFixed(1)}%)`);
  console.log(`Medium Quality (60-79): ${mediumQuality} (${(mediumQuality/report.analyses.length*100).toFixed(1)}%)`);
  console.log(`Low Quality (<60): ${lowQuality} (${(lowQuality/report.analyses.length*100).toFixed(1)}%)`);
  
  // Issue analysis
  let totalIssues = 0;
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const issueTypes = {};
  
  for (const analysis of report.analyses) {
    totalIssues += analysis.issues.length;
    for (const issue of analysis.issues) {
      severityCounts[issue.severity]++;
      if (!issueTypes[issue.type]) issueTypes[issue.type] = 0;
      issueTypes[issue.type]++;
    }
  }
  
  console.log(`\n🚨 QUALITY ISSUES FOUND`);
  console.log('='.repeat(30));
  console.log(`Total Issues: ${totalIssues}`);
  console.log(`Critical: ${severityCounts.critical}`);
  console.log(`High: ${severityCounts.high}`);
  console.log(`Medium: ${severityCounts.medium}`);
  console.log(`Low: ${severityCounts.low}`);
  
  if (Object.keys(issueTypes).length > 0) {
    console.log(`\nIssue Types:`);
    for (const [type, count] of Object.entries(issueTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }
  
  // Agent performance analysis
  const agentStats = {};
  for (const analysis of report.analyses) {
    for (const agent of analysis.agentAnalyses) {
      if (!agentStats[agent.agentRole]) {
        agentStats[agent.agentRole] = { 
          count: 0, 
          totalConfidence: 0, 
          totalRelevance: 0,
          deleteRecommendations: 0
        };
      }
      const stats = agentStats[agent.agentRole];
      stats.count++;
      stats.totalConfidence += agent.confidenceScore;
      stats.totalRelevance += agent.relevanceScore;
      if (agent.deleteRecommendation) stats.deleteRecommendations++;
    }
  }
  
  console.log(`\n🤖 AGENT PERFORMANCE ACROSS FULL COLLECTION`);
  console.log('='.repeat(50));
  for (const [agent, stats] of Object.entries(agentStats).sort((a, b) => b[1].count - a[1].count)) {
    const participation = (stats.count / report.analyses.length * 100).toFixed(1);
    const avgConfidence = (stats.totalConfidence / stats.count * 100).toFixed(1);
    const avgRelevance = (stats.totalRelevance / stats.count * 100).toFixed(1);
    const deleteRate = (stats.deleteRecommendations / stats.count * 100).toFixed(1);
    
    console.log(`${agent}:`);
    console.log(`  Participation: ${stats.count}/${report.analyses.length} (${participation}%)`);
    console.log(`  Avg Confidence: ${avgConfidence}%`);
    console.log(`  Avg Relevance: ${avgRelevance}%`);
    console.log(`  Delete Rate: ${deleteRate}%`);
    console.log('');
  }
  
  // Memory type analysis
  const typeStats = {};
  for (const analysis of report.analyses) {
    // Get memory to check type
    const memory = await dbService.getMemory(analysis.memoryId);
    const type = memory ? memory.content_type : 'unknown';
    
    if (!typeStats[type]) {
      typeStats[type] = { count: 0, avgQuality: 0, deleteCount: 0 };
    }
    typeStats[type].count++;
    typeStats[type].avgQuality += analysis.qualityScore;
    if (analysis.consensus.finalDecision) typeStats[type].deleteCount++;
  }
  
  console.log(`📊 MEMORY TYPE ANALYSIS`);
  console.log('='.repeat(30));
  for (const [type, stats] of Object.entries(typeStats)) {
    const avgQuality = (stats.avgQuality / stats.count).toFixed(1);
    const deleteRate = (stats.deleteCount / stats.count * 100).toFixed(1);
    console.log(`${type}: ${stats.count} memories, ${avgQuality}/100 avg quality, ${deleteRate}% delete rate`);
  }
  
  // Processing efficiency
  const totalProcessingTime = report.analyses.reduce((sum, a) => sum + a.processingTimeMs, 0);
  const efficiency = (totalProcessingTime / 1000 / 60).toFixed(1); // minutes
  
  console.log(`\n⚡ PROCESSING EFFICIENCY`);
  console.log('='.repeat(30));
  console.log(`Total Agent Processing: ${efficiency} minutes`);
  console.log(`Throughput: ${(report.analyses.length / (totalTime / 1000 / 60)).toFixed(1)} memories/minute`);
  
  // Top recommendations for deletion (if any)
  const deleteRecommendations = report.analyses.filter(a => a.consensus.finalDecision);
  if (deleteRecommendations.length > 0) {
    console.log(`\n🗑️  TOP DELETION RECOMMENDATIONS`);
    console.log('='.repeat(40));
    for (const rec of deleteRecommendations.slice(0, 5)) {
      console.log(`Memory: ${rec.memoryId.substring(0, 8)}... (Quality: ${rec.qualityScore})`);
      console.log(`Consensus: ${(rec.consensus.consensusConfidence * 100).toFixed(1)}% confidence`);
      console.log('');
    }
  }
  
  console.log('✅ FULL COLLECTION ANALYSIS COMPLETE');
  console.log(`🎯 Your memory collection shows ${avgQuality.toFixed(1)}/100 average quality`);
  console.log(`🎯 Multi-AI system processed ${report.analyses.length} memories in ${(totalTime/1000).toFixed(1)}s`);
}

fullCuratorReport().catch(console.error);