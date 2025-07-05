// Author: PB and Claude
// Date: 2025-07-04
// License: (c) HRDAG, 2025, GPL-2 or newer
//
// ------
// src/tools/analyze-memory-quality.ts

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { Memory } from '../db/service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface MemoryQualityIssue {
  type: 'outdated_code' | 'broken_path' | 'duplicate' | 'inconsistent' | 'low_quality';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  suggestion?: string;
  relatedMemoryIds?: string[];
}

export interface MemoryQualityAnalysis {
  memoryId: string;
  qualityScore: number; // 0-100
  issues: MemoryQualityIssue[];
  lastAnalyzed: Date;
}

export interface QualityAnalysisParams {
  memoryId?: string;        // Analyze specific memory
  projectId?: string;       // Analyze all memories in project
  codebaseRoot?: string;    // Path to codebase for reality checking
  includeCodeCheck?: boolean; // Whether to check against current code
  limit?: number;           // Max memories to analyze
}

/**
 * Memory Quality Analyzer Tool
 * 
 * Analyzes memory quality by:
 * 1. Checking file paths referenced in memories still exist
 * 2. Detecting code examples that don't match current codebase
 * 3. Finding duplicate or very similar memories
 * 4. Identifying inconsistent information
 * 5. Scoring overall memory usefulness
 */
export class AnalyzeMemoryQualityTool extends BaseMCPTool {
  async handle(params: QualityAnalysisParams = {}): Promise<MCPResponse> {
    try {
      const {
        memoryId,
        projectId,
        codebaseRoot = process.cwd(),
        includeCodeCheck = true,
        limit = 50
      } = params;

      let memoriesToAnalyze: Memory[];

      // Get memories to analyze
      if (memoryId) {
        const memory = await this.dbService.getMemory(memoryId);
        memoriesToAnalyze = memory ? [memory] : [];
      } else {
        // Analyze all development memories or specific project
        memoriesToAnalyze = await this.dbService.getDevMemories(limit);
      }

      if (memoriesToAnalyze.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'No memories found to analyze',
              memoryId,
              projectId
            }, null, 2)
          }]
        };
      }

      // Analyze each memory
      const analyses: MemoryQualityAnalysis[] = [];
      for (const memory of memoriesToAnalyze) {
        const analysis = await this.analyzeMemoryQuality(memory, codebaseRoot, includeCodeCheck);
        analyses.push(analysis);
      }

      // Generate summary report
      const report = this.generateQualityReport(analyses, memoriesToAnalyze.length);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(report, null, 2)
        }]
      };

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Memory quality analysis failed',
            details: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async analyzeMemoryQuality(
    memory: Memory, 
    codebaseRoot: string, 
    includeCodeCheck: boolean
  ): Promise<MemoryQualityAnalysis> {
    const issues: MemoryQualityIssue[] = [];
    
    // 1. Check for broken file paths
    const pathIssues = await this.checkFilePaths(memory, codebaseRoot);
    issues.push(...pathIssues);

    // 2. Check for outdated code references (if enabled)
    if (includeCodeCheck) {
      const codeIssues = await this.checkCodeReality(memory, codebaseRoot);
      issues.push(...codeIssues);
    }

    // 3. Check for potential duplicates
    const duplicateIssues = await this.checkForDuplicates(memory);
    issues.push(...duplicateIssues);

    // 4. Check content quality
    const qualityIssues = this.checkContentQuality(memory);
    issues.push(...qualityIssues);

    // Calculate quality score based on issues
    const qualityScore = this.calculateQualityScore(issues, memory);

    return {
      memoryId: memory.memory_id,
      qualityScore,
      issues,
      lastAnalyzed: new Date()
    };
  }

  private async checkFilePaths(memory: Memory, codebaseRoot: string): Promise<MemoryQualityIssue[]> {
    const issues: MemoryQualityIssue[] = [];
    
    try {
      // Use Tree-sitter to parse memory content as markdown for semantic path extraction
      const filePaths = await this.extractFilePathsWithTreeSitter(memory.content);
      
      for (const filePath of filePaths) {
        const fullPath = this.resolveFilePath(filePath, codebaseRoot);
        
        if (fullPath && !fs.existsSync(fullPath)) {
          issues.push({
            type: 'broken_path',
            severity: 'medium',
            description: `Referenced file does not exist: ${filePath}`,
            suggestion: `Check if file was moved/renamed or update memory content`
          });
        }
      }
    } catch (error) {
      // Fallback to simple pattern matching if Tree-sitter fails
      console.warn('Tree-sitter parsing failed, falling back to pattern matching:', error);
      const fallbackPaths = this.extractFilePathsFallback(memory.content);
      
      for (const filePath of fallbackPaths) {
        const fullPath = this.resolveFilePath(filePath, codebaseRoot);
        
        if (fullPath && !fs.existsSync(fullPath)) {
          issues.push({
            type: 'broken_path',
            severity: 'medium',
            description: `Referenced file does not exist: ${filePath}`,
            suggestion: `Check if file was moved/renamed or update memory content`
          });
        }
      }
    }

    return issues;
  }

  private async extractFilePathsWithTreeSitter(content: string): Promise<string[]> {
    const paths: string[] = [];
    
    try {
      // Create temporary file with memory content for Tree-sitter parsing
      const tempFile = path.join(os.tmpdir(), `memory-content-${Date.now()}.md`);
      fs.writeFileSync(tempFile, content, 'utf8');
      
      // We would use MCP Tree-sitter here, but since we're inside the MCP server
      // we can't easily call other MCP tools. Let's use a simpler semantic approach.
      
      // Clean up temp file
      fs.unlinkSync(tempFile);
      
      // For now, use improved pattern matching that's more semantic
      paths.push(...this.extractFilePathsSemantic(content));
      
    } catch (error) {
      console.warn('Tree-sitter extraction failed:', error);
      // Fall back to semantic pattern matching
      paths.push(...this.extractFilePathsSemantic(content));
    }
    
    return paths;
  }

  private extractFilePathsSemantic(content: string): string[] {
    const paths: string[] = [];
    
    // Split content into lines and analyze context
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Look for file paths in specific contexts
      const trimmedLine = line.trim();
      
      // Skip if line looks like it's explaining a pattern rather than referencing a file
      if (trimmedLine.includes('pattern') || trimmedLine.includes('regex') || trimmedLine.includes('example')) {
        continue;
      }
      
      // Look for common file path indicators
      const pathIndicators = [
        'CONFIG LOCATION:',
        'File:',
        'Path:',
        'Location:',
        'src/',
        './',
        '~/',
        'import from',
        'require(',
      ];
      
      const hasPathIndicator = pathIndicators.some(indicator => 
        trimmedLine.toLowerCase().includes(indicator.toLowerCase())
      );
      
      if (hasPathIndicator) {
        // Extract file paths from this line using improved patterns
        const fileExtensions = ['ts', 'js', 'py', 'md', 'json', 'toml', 'sql', 'yaml', 'yml'];
        const extensionPattern = `\\.(${fileExtensions.join('|')})`;
        
        // Tilde paths (most reliable)
        const tildeMatches = trimmedLine.match(new RegExp(`~/[^\\s\\)\\]]+${extensionPattern}`, 'g'));
        if (tildeMatches) paths.push(...tildeMatches);
        
        // Relative paths starting with src/ or ./
        const relativeMatches = trimmedLine.match(new RegExp(`(?:src/|\\./)[^\\s\\)\\]]+${extensionPattern}`, 'g'));
        if (relativeMatches) paths.push(...relativeMatches);
        
        // Absolute paths with full directory structure
        const absoluteMatches = trimmedLine.match(new RegExp(`/(?:Users|home|opt|usr|var|etc)/[^\\s\\)\\]]+${extensionPattern}`, 'g'));
        if (absoluteMatches) paths.push(...absoluteMatches);
      }
    }
    
    // Remove duplicates
    return [...new Set(paths)];
  }

  private extractFilePathsFallback(content: string): string[] {
    // Basic fallback that's less likely to have false positives
    const fileExtensions = ['ts', 'js', 'py', 'md', 'json', 'toml', 'sql', 'yaml', 'yml'];
    const extensionPattern = `\\.(${fileExtensions.join('|')})`;
    
    const patterns = [
      new RegExp(`~/[^\\s\\)\\]]+${extensionPattern}`, 'g'),
      new RegExp(`(?:src/|\\./)[^\\s\\)\\]]+${extensionPattern}`, 'g'),
    ];
    
    const paths: string[] = [];
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) paths.push(...matches);
    }
    
    return [...new Set(paths)];
  }

  private resolveFilePath(filePath: string, codebaseRoot: string): string | null {
    try {
      // Handle tilde expansion
      if (filePath.startsWith('~/')) {
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (!homeDir) return null;
        return path.join(homeDir, filePath.slice(2));
      }
      
      // Handle absolute paths - use as-is
      if (path.isAbsolute(filePath)) {
        return filePath;
      }
      
      // Handle relative paths - resolve against codebase root
      if (filePath.startsWith('./')) {
        return path.resolve(codebaseRoot, filePath.slice(2));
      }
      
      // Handle src/ and other relative paths
      return path.resolve(codebaseRoot, filePath);
    } catch (error) {
      // If path resolution fails, skip this path
      return null;
    }
  }

  private async checkCodeReality(memory: Memory, codebaseRoot: string): Promise<MemoryQualityIssue[]> {
    const issues: MemoryQualityIssue[] = [];
    
    // Look for code examples in memory (basic detection)
    const codePatterns = [
      /```[\s\S]*?```/g,           // Code blocks
      /`[^`\n]+`/g,                // Inline code
      /function\s+\w+/g,           // Function declarations
      /class\s+\w+/g,              // Class declarations
      /interface\s+\w+/g,          // Interface declarations
      /const\s+\w+\s*=/g,          // Const declarations
    ];

    let hasCodeExamples = false;
    for (const pattern of codePatterns) {
      if (pattern.test(memory.content)) {
        hasCodeExamples = true;
        break;
      }
    }

    if (hasCodeExamples) {
      // This is a simplified check - in a full implementation,
      // we'd use Tree-sitter to parse and compare actual code structures
      const metadata = this.parseMetadata(memory.metadata);
      const filesCreated = metadata.files_created || [];
      
      for (const file of filesCreated) {
        const fullPath = path.resolve(codebaseRoot, file);
        if (!fs.existsSync(fullPath)) {
          issues.push({
            type: 'outdated_code',
            severity: 'high',
            description: `Memory references code file that no longer exists: ${file}`,
            suggestion: `Update memory or mark as historical if code was intentionally removed`
          });
        }
      }
    }

    return issues;
  }

  private async checkForDuplicates(memory: Memory): Promise<MemoryQualityIssue[]> {
    const issues: MemoryQualityIssue[] = [];
    
    try {
      // Use semantic search to find similar memories
      const similar = await this.dbService.findSimilarMemories(memory.content, 5);
      
      // Filter out the memory itself and check for high similarity
      const duplicates = similar.filter(m => 
        m.memory_id !== memory.memory_id && 
        (m.similarity || 0) > 0.85
      );

      if (duplicates.length > 0) {
        issues.push({
          type: 'duplicate',
          severity: 'medium',
          description: `Found ${duplicates.length} very similar memories (>85% similarity)`,
          suggestion: `Consider merging these memories or removing duplicates`,
          relatedMemoryIds: duplicates.map(m => m.memory_id)
        });
      }
    } catch (error) {
      // Similarity search failed, skip duplicate checking
    }

    return issues;
  }

  private checkContentQuality(memory: Memory): MemoryQualityIssue[] {
    const issues: MemoryQualityIssue[] = [];
    const content = memory.content;

    // Check for very short content
    if (content.length < 50) {
      issues.push({
        type: 'low_quality',
        severity: 'low',
        description: 'Memory content is very short and may lack useful detail',
        suggestion: 'Consider expanding with more context or merging with related memories'
      });
    }

    // Check for placeholder text
    const placeholders = ['TODO', 'FIXME', 'XXX', 'PLACEHOLDER', 'TBD'];
    for (const placeholder of placeholders) {
      if (content.includes(placeholder)) {
        issues.push({
          type: 'low_quality',
          severity: 'low',
          description: `Memory contains placeholder text: ${placeholder}`,
          suggestion: 'Update memory with actual implementation details'
        });
      }
    }

    // Check for debugging content
    const debugPatterns = ['console.log', 'print(', 'DEBUG:', 'TEST:'];
    for (const pattern of debugPatterns) {
      if (content.includes(pattern)) {
        issues.push({
          type: 'low_quality',
          severity: 'low',
          description: `Memory contains debug/test code: ${pattern}`,
          suggestion: 'Clean up debug content or mark as development note'
        });
      }
    }

    return issues;
  }

  private calculateQualityScore(issues: MemoryQualityIssue[], memory: Memory): number {
    let score = 100;

    // Deduct points based on issue severity
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical': score -= 30; break;
        case 'high': score -= 20; break;
        case 'medium': score -= 10; break;
        case 'low': score -= 5; break;
      }
    }

    // Bonus points for good metadata
    const metadata = this.parseMetadata(memory.metadata);
    if (metadata.key_decisions?.length) score += 5;
    if (metadata.implementation_status) score += 5;
    if (metadata.files_created?.length) score += 5;

    // Bonus for recent content
    const createdAt = new Date(memory.created_at);
    const daysSinceCreated = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 7) score += 10;
    else if (daysSinceCreated < 30) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  private parseMetadata(metadataString: string): any {
    try {
      return JSON.parse(metadataString);
    } catch {
      return {};
    }
  }

  private generateQualityReport(analyses: MemoryQualityAnalysis[], totalMemories: number) {
    const avgScore = analyses.reduce((sum, a) => sum + a.qualityScore, 0) / analyses.length;
    const issueCountsBySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const issueCountsByType = { outdated_code: 0, broken_path: 0, duplicate: 0, inconsistent: 0, low_quality: 0 };

    for (const analysis of analyses) {
      for (const issue of analysis.issues) {
        issueCountsBySeverity[issue.severity]++;
        issueCountsByType[issue.type]++;
      }
    }

    const topIssues = analyses
      .filter(a => a.issues.length > 0)
      .sort((a, b) => b.issues.length - a.issues.length)
      .slice(0, 10);

    return {
      summary: {
        memoriesAnalyzed: analyses.length,
        totalMemories,
        averageQualityScore: Math.round(avgScore * 10) / 10,
        qualityDistribution: {
          excellent: analyses.filter(a => a.qualityScore >= 90).length,
          good: analyses.filter(a => a.qualityScore >= 70 && a.qualityScore < 90).length,
          fair: analyses.filter(a => a.qualityScore >= 50 && a.qualityScore < 70).length,
          poor: analyses.filter(a => a.qualityScore < 50).length
        }
      },
      issues: {
        totalIssues: Object.values(issueCountsBySeverity).reduce((sum, count) => sum + count, 0),
        bySeverity: issueCountsBySeverity,
        byType: issueCountsByType
      },
      recommendations: [
        issueCountsBySeverity.critical > 0 ? `🚨 ${issueCountsBySeverity.critical} critical issues need immediate attention` : null,
        issueCountsByType.duplicate > 0 ? `🔄 ${issueCountsByType.duplicate} duplicate memories could be merged` : null,
        issueCountsByType.broken_path > 0 ? `📁 ${issueCountsByType.broken_path} broken file paths need updating` : null,
        issueCountsByType.outdated_code > 0 ? `⏰ ${issueCountsByType.outdated_code} memories have outdated code references` : null
      ].filter(Boolean),
      topProblematicMemories: topIssues.map(analysis => ({
        memoryId: analysis.memoryId,
        qualityScore: analysis.qualityScore,
        issueCount: analysis.issues.length,
        mainIssues: analysis.issues.slice(0, 3).map(i => `${i.severity}: ${i.type}`)
      })),
      detailedAnalyses: analyses
    };
  }
}