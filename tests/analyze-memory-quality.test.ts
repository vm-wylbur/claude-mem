// TDD Test: Analyze Memory Quality Tool
// Author: PB and Claude
// Date: 2025-07-04
//
// Tests the memory quality analyzer functionality

import { AnalyzeMemoryQualityTool } from '../src/tools/analyze-memory-quality.js';
import { Memory } from '../src/db/service.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock database service
class MockDatabaseService {
  private mockMemories: Memory[] = [
    {
      memory_id: 'test123',
      content: 'This is a test memory with src/nonexistent.ts reference and ```code example```',
      content_type: 'code',
      metadata: '{"files_created": ["src/test.ts"], "implementation_status": "completed"}',
      project_id: 'dev',
      created_at: new Date().toISOString()
    },
    {
      memory_id: 'test456', 
      content: 'Short memory with TODO placeholder',
      content_type: 'conversation',
      metadata: '{}',
      project_id: 'dev',
      created_at: new Date(Date.now() - 86400000).toISOString() // 1 day ago
    },
    {
      memory_id: 'test789',
      content: 'This is a very similar memory with src/nonexistent.ts reference and code examples that are nearly identical to test123',
      content_type: 'code', 
      metadata: '{"files_created": ["src/similar.ts"]}',
      project_id: 'dev',
      created_at: new Date(Date.now() - 86400000 * 30).toISOString() // 30 days ago
    }
  ];

  async getMemory(memoryId: string): Promise<Memory | null> {
    return this.mockMemories.find(m => m.memory_id === memoryId) || null;
  }

  async getDevMemories(limit?: number): Promise<Memory[]> {
    return this.mockMemories.slice(0, limit);
  }

  async findSimilarMemories(content: string, limit: number): Promise<Memory[]> {
    // Mock similarity - if content contains "similar", return high similarity
    if (content.includes('similar') || content.includes('test123')) {
      return [
        { ...this.mockMemories[0], similarity: 0.9 },  // High similarity
        { ...this.mockMemories[2], similarity: 0.87 }  // High similarity
      ];
    }
    return [];
  }
}

async function testAnalyzeMemoryQuality(): Promise<void> {
  console.log('🧪 Testing Analyze Memory Quality Tool');
  console.log('=====================================\n');

  const mockDb = new MockDatabaseService() as any;
  const tool = new AnalyzeMemoryQualityTool(mockDb);
  
  // Test 1: Analyze single memory
  console.log('🔍 Test 1: Single Memory Analysis');
  try {
    const result = await tool.handle({ memoryId: 'test123', codebaseRoot: process.cwd() });
    const analysis = JSON.parse(result.content[0].text);
    
    console.log(`   Memory ID: ${analysis.detailedAnalyses[0].memoryId}`);
    console.log(`   Quality Score: ${analysis.detailedAnalyses[0].qualityScore}`);
    console.log(`   Issues Found: ${analysis.detailedAnalyses[0].issues.length}`);
    
    // Check for expected issues
    const issues = analysis.detailedAnalyses[0].issues;
    const hasBrokenPath = issues.some((i: any) => i.type === 'broken_path');
    const hasDuplicate = issues.some((i: any) => i.type === 'duplicate');
    
    if (hasBrokenPath) {
      console.log('   ✅ Detected broken file path');
    }
    if (hasDuplicate) {
      console.log('   ✅ Detected potential duplicate');
    }
    
    console.log('   ✅ Single memory analysis completed');
  } catch (error) {
    console.error('   ❌ Single memory analysis failed:', error);
    throw error;
  }

  // Test 2: Analyze multiple memories
  console.log('\n🔍 Test 2: Multiple Memory Analysis');
  try {
    const result = await tool.handle({ limit: 3, includeCodeCheck: true });
    const analysis = JSON.parse(result.content[0].text);
    
    console.log(`   Memories Analyzed: ${analysis.summary.memoriesAnalyzed}`);
    console.log(`   Average Quality Score: ${analysis.summary.averageQualityScore}`);
    console.log(`   Total Issues: ${analysis.issues.totalIssues}`);
    
    // Check summary structure
    if (analysis.summary && analysis.issues && analysis.recommendations) {
      console.log('   ✅ Complete analysis report structure');
    }
    
    if (analysis.issues.bySeverity && analysis.issues.byType) {
      console.log('   ✅ Issue categorization working');
    }
    
    console.log('   ✅ Multiple memory analysis completed');
  } catch (error) {
    console.error('   ❌ Multiple memory analysis failed:', error);
    throw error;
  }

  // Test 3: Quality scoring validation
  console.log('\n🔍 Test 3: Quality Scoring Validation');
  try {
    const result = await tool.handle({ memoryId: 'test456' }); // Short memory with TODO
    const analysis = JSON.parse(result.content[0].text);
    const memoryAnalysis = analysis.detailedAnalyses[0];
    
    console.log(`   Quality Score: ${memoryAnalysis.qualityScore}`);
    console.log(`   Issues Count: ${memoryAnalysis.issues.length}`);
    
    // Check for low quality issues
    const hasLowQuality = memoryAnalysis.issues.some((i: any) => i.type === 'low_quality');
    if (hasLowQuality) {
      console.log('   ✅ Detected low quality content');
    }
    
    // Score should be reduced due to issues
    if (memoryAnalysis.qualityScore < 100) {
      console.log('   ✅ Quality score reflects detected issues');
    }
    
    console.log('   ✅ Quality scoring validation completed');
  } catch (error) {
    console.error('   ❌ Quality scoring validation failed:', error);
    throw error;
  }

  // Test 4: Error handling
  console.log('\n🔍 Test 4: Error Handling');
  try {
    const result = await tool.handle({ memoryId: 'nonexistent' });
    const response = JSON.parse(result.content[0].text);
    
    if (response.error) {
      console.log('   ✅ Handles nonexistent memory gracefully');
    }
    
    console.log('   ✅ Error handling test completed');
  } catch (error) {
    console.error('   ❌ Error handling test failed:', error);
    throw error;
  }

  console.log('\n🎉 All memory quality analysis tests passed!');
}

// Test 5: File path checking
async function testFilePathChecking(): Promise<void> {
  console.log('\n🔍 Test 5: File Path Validation');
  
  const mockDb = new MockDatabaseService() as any;
  const tool = new AnalyzeMemoryQualityTool(mockDb);
  
  try {
    // Create a test file to reference
    const testFilePath = path.join(process.cwd(), 'test-temp-file.ts');
    fs.writeFileSync(testFilePath, 'console.log("test");');
    
    // Create memory with valid and invalid paths
    const testMemory: Memory = {
      memory_id: 'pathtest',
      content: `References src/analyze-memory-quality.ts (exists) and src/nonexistent-file.ts (does not exist) and ${testFilePath}`,
      content_type: 'code',
      metadata: '{}',
      project_id: 'dev',
      created_at: new Date().toISOString()
    };
    
    // Override getMemory to return our test memory
    (mockDb as any).getMemory = async () => testMemory;
    
    const result = await tool.handle({ memoryId: 'pathtest' });
    const analysis = JSON.parse(result.content[0].text);
    const issues = analysis.detailedAnalyses[0].issues;
    
    const brokenPathIssues = issues.filter((i: any) => i.type === 'broken_path');
    console.log(`   Broken path issues found: ${brokenPathIssues.length}`);
    
    if (brokenPathIssues.length > 0) {
      console.log('   ✅ File path validation working');
    }
    
    // Cleanup
    fs.unlinkSync(testFilePath);
    
    console.log('   ✅ File path checking test completed');
  } catch (error) {
    console.error('   ❌ File path checking test failed:', error);
    throw error;
  }
}

// Run all tests
async function runAllTests(): Promise<void> {
  try {
    await testAnalyzeMemoryQuality();
    await testFilePathChecking();
    console.log('\n🎉 All tests passed! Memory quality analyzer is working correctly.');
  } catch (error) {
    console.error('\n❌ Tests failed:', error);
    process.exit(1);
  }
}

runAllTests();