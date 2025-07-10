// Test script for Multi-AI Memory Curation System
// Author: PB and Claude
// Date: 2025-07-08

import { config } from 'dotenv';
import { DatabaseService } from './src/db/service.js';
import { createDatabaseAdapterToml } from './src/config.js';
import { MultiAIAnalyzeMemoryQualityTool, GENERAL_CURATOR, SECURITY_SPECIALIST, ConsensusEngine } from './src/tools/multi-ai-analyze-memory-quality.js';

async function testMultiAISystem() {
  console.log('🚀 Testing Multi-AI Memory Curation System\n');
  
  try {
    // Load environment variables
    config();
    
    // Initialize database service with adapter
    const adapter = await createDatabaseAdapterToml();
    const dbService = new DatabaseService(adapter);
    await dbService.initialize();
    
    // Test 1: Agent Relevance Scoring
    console.log('📊 Test 1: Agent Relevance Scoring');
    
    // Get a few sample memories
    const memories = await dbService.getDevMemories(5);
    console.log(`Found ${memories.length} memories to test\n`);
    
    for (const memory of memories.slice(0, 3)) {
      const generalRelevance = GENERAL_CURATOR.relevanceScoring(memory);
      const securityRelevance = SECURITY_SPECIALIST.relevanceScoring(memory);
      
      console.log(`Memory: ${memory.memory_id.substring(0, 8)}...`);
      console.log(`  General Curator Relevance: ${generalRelevance.toFixed(2)}`);
      console.log(`  Security Specialist Relevance: ${securityRelevance.toFixed(2)}`);
      console.log(`  Content preview: ${memory.content.substring(0, 100)}...`);
      console.log('');
    }
    
    // Test 2: Consensus Engine
    console.log('🤝 Test 2: Consensus Engine');
    
    const consensusEngine = new ConsensusEngine();
    
    // Mock agent analyses for testing
    const mockAnalyses = [
      {
        agentRole: 'general-curator',
        confidenceScore: 0.8,
        relevanceScore: 1.0,
        findings: [],
        deleteRecommendation: false,
        reasoning: 'Memory appears to have good quality and relevance',
        specializedInsights: ['Well-structured content', 'Clear implementation details']
      },
      {
        agentRole: 'security-specialist',
        confidenceScore: 0.6,
        relevanceScore: 0.3,
        findings: [],
        deleteRecommendation: false,
        reasoning: 'No significant security concerns identified',
        specializedInsights: ['No exposed credentials', 'Low security relevance']
      }
    ];
    
    const consensus = consensusEngine.calculateWeightedConsensus(mockAnalyses);
    
    console.log('Consensus Result:');
    console.log(`  Final Decision: ${consensus.finalDecision ? 'DELETE' : 'KEEP'}`);
    console.log(`  Consensus Confidence: ${consensus.consensusConfidence.toFixed(3)}`);
    console.log(`  Agreement Level: ${consensus.agreementLevel.toFixed(3)}`);
    console.log(`  Weighted Score: ${consensus.weightedScore.toFixed(3)}`);
    console.log(`  Requires Human Review: ${consensus.requiresHumanReview}`);
    console.log(`  Minority Views: ${consensus.minorityViews.length}`);
    console.log('');
    
    // Test 3: Multi-AI Tool Integration
    console.log('🔧 Test 3: Multi-AI Tool Integration');
    
    const multiAITool = new MultiAIAnalyzeMemoryQualityTool(dbService, true);
    
    if (memories.length > 0) {
      console.log(`Testing with memory: ${memories[0].memory_id.substring(0, 8)}...`);
      
      const result = await multiAITool.handle({
        memoryId: memories[0].memory_id,
        limit: 1
      });
      
      console.log('Multi-AI Analysis Result:');
      const parsed = JSON.parse(result.content[0].text);
      console.log(`  Memories Analyzed: ${parsed.summary?.memoriesAnalyzed || 'N/A'}`);
      console.log(`  Avg Processing Time: ${parsed.summary?.averageProcessingTimeMs || 'N/A'}ms`);
      console.log(`  Agents Used: ${parsed.metadata?.agentsUsed?.join(', ') || 'N/A'}`);
      
      if (parsed.analyses && parsed.analyses.length > 0) {
        const analysis = parsed.analyses[0];
        console.log(`  Quality Score: ${analysis.qualityScore}`);
        console.log(`  Agent Analyses: ${analysis.agentAnalyses?.length || 0}`);
        console.log(`  Consensus Confidence: ${analysis.consensus?.consensusConfidence?.toFixed(3) || 'N/A'}`);
      }
    }
    
    console.log('\n✅ Multi-AI System Test Complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testMultiAISystem().catch(console.error);
}

export { testMultiAISystem };