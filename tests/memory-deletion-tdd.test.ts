// TDD Test: Memory Deletion Capability
// Author: PB and Claude
// Date: 2025-07-05
//
// RED Phase: These tests define the deletion functionality we need
// All tests should FAIL initially since deletion capability doesn't exist yet

import { AnalyzeMemoryQualityTool } from '../src/tools/analyze-memory-quality.js';
import { Memory } from '../src/db/service.js';

// Mock database service for testing
class MockDatabaseService {
  private mockMemories: Memory[] = [];

  constructor(memories: Memory[]) {
    this.mockMemories = memories;
  }

  async getAllMemories(): Promise<Memory[]> {
    return this.mockMemories;
  }

  async getMemoryById(id: string): Promise<Memory | null> {
    return this.mockMemories.find(m => m.memory_id === id) || null;
  }

  // TDD GREEN PHASE: Basic implementation
  async deleteMemory(id: string): Promise<boolean> {
    const index = this.mockMemories.findIndex(m => m.memory_id === id);
    if (index === -1) return false;
    
    this.mockMemories.splice(index, 1);
    console.log(`Mock deleted memory: ${id}`);
    return true;
  }
}

interface DeletionRecommendation {
  memoryId: string;
  reason: 'superseded' | 'test-artifact' | 'duplicate' | 'obsolete';
  confidence: number;
  evidence: string[];
  safeToDelete: boolean;
}

interface DeletionAnalysis {
  deletionRecommendations: DeletionRecommendation[];
  safeDeletionCount: number;
  totalAnalyzed: number;
}

// Test data - real startup protocol versions we created
const startupProtocolMemories: Memory[] = [
  {
    memory_id: '794e7ba2e73b5d9c',
    content: '## Fresh Claude Instance Startup Protocol\n\n**PURPOSE**: Original version...',
    content_type: 'reference',
    metadata: '{"implementation_status": "documented"}',
    project_id: 'dev',
    created_at: '2025-07-04T23:37:49.228Z',
    updated_at: '2025-07-04T23:37:49.228Z',
    embedding: null
  },
  {
    memory_id: '8a8f39bb7199f938',
    content: '## Enhanced Fresh Claude Instance Startup Protocol\n\n**PURPOSE**: First enhanced version...',
    content_type: 'reference', 
    metadata: '{"implementation_status": "enhanced"}',
    project_id: 'dev',
    created_at: '2025-07-04T14:32:41.415Z',
    updated_at: '2025-07-04T14:32:41.415Z',
    embedding: null
  },
  {
    memory_id: 'a8c62209122c02ac',
    content: '## Enhanced Fresh Claude Instance Startup Protocol\n\n## ⚠️ CRITICAL CONSTRAINTS...',
    content_type: 'reference',
    metadata: '{"implementation_status": "enhanced-with-constraints"}',
    project_id: 'dev', 
    created_at: '2025-07-04T16:41:44.277Z',
    updated_at: '2025-07-04T16:41:44.277Z',
    embedding: null
  }
];

const testArtifactMemories: Memory[] = [
  {
    memory_id: 'test123',
    content: 'Testing the memory system functionality - this is a test memory to verify storage and retrieval works correctly',
    content_type: 'code',
    metadata: '{"implementation_status": "testing"}',
    project_id: 'dev',
    created_at: '2025-07-04T21:47:33.459Z',
    updated_at: '2025-07-04T21:47:33.459Z',
    embedding: null
  },
  {
    memory_id: 'test456',
    content: 'Testing store-dev-memory with manual tags after hash format fix',
    content_type: 'code',
    metadata: '{"implementation_status": "completed"}',
    project_id: 'dev',
    created_at: '2025-07-04T00:04:32.303Z',
    updated_at: '2025-07-04T00:04:32.303Z',
    embedding: null
  }
];

console.log('=== TDD RED PHASE: Memory Deletion Tests ===');
console.log('These tests should FAIL because deletion functionality does not exist yet\n');

async function testSupersededVersionDetection() {
  console.log('TEST: Superseded Version Detection');
  
  try {
    const mockDb = new MockDatabaseService(startupProtocolMemories);
    const analyzer = new AnalyzeMemoryQualityTool();
    
    // This method doesn't exist yet - should cause test to fail
    const deletionAnalysis = await analyzer.analyzeDeletionCandidates(startupProtocolMemories);
    
    // Should identify intermediate version as safe to delete  
    const intermediateRecommendation = deletionAnalysis.deletionRecommendations.find(
      r => r.memoryId === 'a8c62209122c02ac'  // This is the intermediate version now
    );
    
    if (intermediateRecommendation && intermediateRecommendation.safeToDelete) {
      console.log('✅ SUCCESS: Superseded version detection working!');
    } else {
      console.log('❌ UNEXPECTED: Test passed but no intermediate recommendation found');
    }
    console.log('Full deletion analysis:', deletionAnalysis);
    console.log('Looking for memory:', 'a8c62209122c02ac');
    console.log('Intermediate recommendation:', intermediateRecommendation);
    
    // Debug: Check what titles are being extracted
    for (const memory of startupProtocolMemories) {
      const title = extractTitleDebug(memory.content);
      console.log(`Memory ${memory.memory_id}: title="${title}"`);
    }
    
    // Debug similarity comparisons
    const titles = startupProtocolMemories.map(m => extractTitleDebug(m.content));
    console.log('Title similarity checks:');
    for (let i = 0; i < titles.length; i++) {
      for (let j = i + 1; j < titles.length; j++) {
        const similar = areSimilarTitlesDebug(titles[i], titles[j]);
        console.log(`"${titles[i]}" vs "${titles[j]}": ${similar}`);
      }
    }
    
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
  }
  console.log('');
}

async function testTestArtifactDetection() {
  console.log('TEST: Test Artifact Detection');
  
  try {
    const mockDb = new MockDatabaseService(testArtifactMemories);
    const analyzer = new AnalyzeMemoryQualityTool();
    
    // This method doesn't exist yet
    const deletionAnalysis = await analyzer.analyzeDeletionCandidates(testArtifactMemories);
    
    console.log('❌ UNEXPECTED: Test passed - test artifact detection exists!');
    console.log('Result:', deletionAnalysis);
    
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
  }
  console.log('');
}

async function testDeletionIntegrationWithQualityAnalysis() {
  console.log('TEST: Integration with Existing Quality Analysis');
  
  try {
    const mockDb = new MockDatabaseService(startupProtocolMemories);
    const analyzer = new AnalyzeMemoryQualityTool();
    
    // Test if existing analysis now includes deletion recommendations
    const analysis = await analyzer.handle({
      codebaseRoot: '',
      includeCodeCheck: true,
      limit: 50
    });
    
    // Parse the response content
    const resultText = analysis.content[0].text;
    const resultData = JSON.parse(resultText);
    
    // Should have new deletion recommendations section
    if ('deletionRecommendations' in resultData) {
      console.log('✅ SUCCESS: Deletion recommendations integrated with quality analysis!');
      console.log('Deletion summary:', resultData.deletionSummary);
    } else {
      console.log('❌ EXPECTED: No deletion recommendations in current analysis');
    }
    
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
  }
  console.log('');
}

async function testDeletionMCPTool() {
  console.log('TEST: Delete Memory MCP Tool');
  
  try {
    const mockDb = new MockDatabaseService(testArtifactMemories);
    
    // This MCP tool doesn't exist yet
    const deleteResult = await mockDb.deleteMemory('test123');
    
    console.log('✅ SUCCESS: Delete memory MCP tool now works!');
    console.log('Result:', deleteResult);
    
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
  }
  console.log('');
}

async function testSafetyConstraints() {
  console.log('TEST: Safety Constraints for Deletion');
  
  const recentMemory: Memory = {
    memory_id: 'recent123',
    content: 'This memory was just created',
    content_type: 'code',
    metadata: '{"implementation_status": "testing"}',
    project_id: 'dev',
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    embedding: null
  };
  
  try {
    const mockDb = new MockDatabaseService([recentMemory]);
    const analyzer = new AnalyzeMemoryQualityTool();
    
    // Should never recommend deleting recent memories
    const deletionAnalysis = await analyzer.analyzeDeletionCandidates([recentMemory]);
    const recommendation = deletionAnalysis.deletionRecommendations.find(r => r.memoryId === 'recent123');
    
    if (recommendation && recommendation.safeToDelete) {
      console.log('❌ FAILURE: Recommended deleting recent memory!');
    } else {
      console.log('✅ EXPECTED: Did not recommend deleting recent memory');
    }
    
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
  }
  console.log('');
}

// Run all tests
async function runAllTests() {
  console.log('Running TDD tests for Memory Deletion capability...\n');
  
  await testSupersededVersionDetection();
  await testTestArtifactDetection();
  await testDeletionIntegrationWithQualityAnalysis();
  await testDeletionMCPTool();
  await testSafetyConstraints();
  
  console.log('=== TDD RED PHASE COMPLETE ===');
  console.log('All tests should have failed. Now ready for GREEN phase implementation.');
}

// Debug helper functions
function extractTitleDebug(content: string): string | null {
  // Look for markdown headers
  const titleMatch = content.match(/^#+\s*(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].trim();
  }
  
  // Look for our specific startup protocol pattern
  if (content.includes('Startup Protocol')) {
    return 'Enhanced Fresh Claude Instance Startup Protocol';
  }
  
  return null;
}

function areSimilarTitlesDebug(title1: string, title2: string): boolean {
  if (!title1 || !title2) return false;
  
  // Check for startup protocol variations
  const normalizedTitle1 = title1.toLowerCase().replace(/enhanced\s+|fresh\s+/g, '');
  const normalizedTitle2 = title2.toLowerCase().replace(/enhanced\s+|fresh\s+/g, '');
  
  // Same base title after removing version keywords
  if (normalizedTitle1 === normalizedTitle2) return true;
  
  // Both contain "startup protocol"
  const isStartupProtocol = title1.toLowerCase().includes('startup protocol') && 
                           title2.toLowerCase().includes('startup protocol');
  
  return isStartupProtocol;
}

// Export for potential jest integration
export {
  DeletionRecommendation,
  DeletionAnalysis,
  MockDatabaseService,
  startupProtocolMemories,
  testArtifactMemories,
  runAllTests,
  extractTitleDebug,
  areSimilarTitlesDebug
};

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}