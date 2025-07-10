// Multi-AI Memory Curation System
// Author: PB and Claude
// Date: 2025-07-08
// License: (c) HRDAG, 2025, GPL-2 or newer

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { Memory } from '../db/service.js';
import { AnalyzeMemoryQualityTool, MemoryQualityAnalysis, MemoryQualityIssue, QualityAnalysisParams } from './analyze-memory-quality.js';

// ============================================
// Multi-AI Agent System Interfaces
// ============================================

export interface AgentRole {
  name: string;
  specialization: string[];
  promptTemplate: string;
  relevanceScoring: (memory: Memory) => number;
}

export interface AgentAnalysis {
  agentRole: string;
  confidenceScore: number;      // 0-1: How confident this agent is in its analysis
  relevanceScore: number;       // 0-1: How relevant this agent's expertise is for this memory
  findings: MemoryQualityIssue[];
  deleteRecommendation: boolean;
  reasoning: string;            // Agent's explanation of its analysis
  specializedInsights: string[]; // Domain-specific insights only this agent would notice
}

export interface ConsensusResult {
  finalDecision: boolean;
  consensusConfidence: number;  // 0-1: Overall confidence in the consensus
  agreementLevel: number;       // 0-1: How much agents agreed (1.0 = unanimous)
  weightedScore: number;        // Weighted average of agent scores
  minorityViews: string[];      // Dissenting opinions and reasoning
  requiresHumanReview: boolean; // True if confidence too low for automation
}

export interface MultiAIAnalysis extends MemoryQualityAnalysis {
  agentAnalyses: AgentAnalysis[];
  consensus: ConsensusResult;
  singleAIComparison?: MemoryQualityAnalysis; // For A/B testing
  processingTimeMs: number;
}

// ============================================
// Agent Role Definitions
// ============================================

export const GENERAL_CURATOR: AgentRole = {
  name: "general-curator",
  specialization: ["quality", "general-analysis", "lifecycle", "content-assessment"],
  promptTemplate: `You are a general memory curator focused on overall quality assessment.

Analyze this memory for:
- Overall content quality and usefulness
- Lifecycle status (active, outdated, superseded)
- General issues with clarity, completeness, accuracy
- Relationship to other memories and knowledge gaps
- Appropriate tagging and categorization

Memory Content:
{content}

Memory Metadata:
{metadata}

Provide structured analysis focusing on broad quality indicators that apply to any type of memory. Consider the memory's value for future reference and knowledge preservation.`,

  relevanceScoring: (memory: Memory) => 1.0 // Always relevant for general assessment
};

export const SECURITY_SPECIALIST: AgentRole = {
  name: "security-specialist",
  specialization: ["security", "vulnerabilities", "compliance", "privacy", "authentication"],
  promptTemplate: `You are a security specialist focused on identifying security-related patterns and concerns.

Analyze this memory for:
- Security vulnerabilities or anti-patterns mentioned
- Authentication, authorization, encryption concerns
- Compliance issues (PII, secrets, regulatory requirements)
- Security best practices adherence
- Potential security risks or exposure

Memory Content:
{content}

Memory Metadata:
{metadata}

Focus specifically on security implications. If this memory has no security relevance, indicate low relevance. If it contains security patterns, vulnerabilities, or compliance concerns, provide detailed analysis.`,

  relevanceScoring: (memory: Memory) => {
    const content = memory.content.toLowerCase();
    const securityKeywords = [
      'password', 'secret', 'token', 'auth', 'security', 'vulnerability', 'encrypt',
      'ssl', 'tls', 'cors', 'csrf', 'xss', 'sql injection', 'permission', 'access',
      'login', 'session', 'api key', 'certificate', 'firewall', 'compliance'
    ];
    
    const keywordMatches = securityKeywords.filter(keyword => content.includes(keyword));
    const baseScore = Math.min(keywordMatches.length / 5, 1.0); // Max relevance at 5+ keywords
    
    // Boost for security-tagged memories
    let tags: string[] = [];
    if (memory.metadata) {
      if (typeof memory.metadata === 'string') {
        try {
          tags = JSON.parse(memory.metadata).tags || [];
        } catch (e) {
          tags = [];
        }
      } else {
        tags = (memory.metadata as any).tags || [];
      }
    }
    const hasSecurityTag = tags.some((tag: string) => tag.toLowerCase().includes('security'));
    
    return hasSecurityTag ? Math.min(baseScore + 0.3, 1.0) : baseScore;
  }
};

// Architecture Specialist Agent - Focuses on design patterns, system relationships, scaling
export const ARCHITECTURE_SPECIALIST: AgentRole = {
  name: "architecture-specialist",
  specialization: ["architecture", "design-patterns", "system-design", "scaling", "modularity"],
  promptTemplate: `You are an expert software architect analyzing memory quality from an architectural perspective.

CRITICAL: Provide balanced analysis acknowledging both strengths and weaknesses. Being thorough means finding the BEST architectural insights IF they exist, not blindly supporting or condemning patterns.

Focus on:
- System design patterns and architectural decisions  
- Component relationships and modularity
- Scalability considerations and technical debt
- Design pattern implementation quality
- System boundaries and interface design

REQUIRED: Address potential counterarguments to your assessment. If you identify architectural issues, acknowledge any mitigating factors. If you praise the design, note any limitations or improvement opportunities.

Analyze this memory for architectural insights, design quality, and system relationships.`,
  
  relevanceScoring: (memory: Memory): number => {
    const content = memory.content.toLowerCase();
    
    const architectureKeywords = [
      'architecture', 'design pattern', 'component', 'module', 'interface',
      'scalability', 'system design', 'coupling', 'cohesion', 'dependency',
      'microservice', 'monolith', 'api design', 'database design', 'schema'
    ];
    
    const keywordMatches = architectureKeywords.filter(keyword => content.includes(keyword));
    const baseScore = Math.min(keywordMatches.length / 6, 1.0);
    
    // Boost for architecture-related tags
    let tags: string[] = [];
    if (memory.metadata) {
      if (typeof memory.metadata === 'string') {
        try {
          tags = JSON.parse(memory.metadata).tags || [];
        } catch (e) {
          tags = [];
        }
      } else {
        tags = (memory.metadata as any).tags || [];
      }
    }
    const hasArchTag = tags.some((tag: string) => tag.toLowerCase().includes('architecture') || tag.toLowerCase().includes('design'));
    
    return hasArchTag ? Math.min(baseScore + 0.3, 1.0) : baseScore;
  }
};

// Python Specialist Agent - Focuses on Python code quality and implementation patterns
export const PYTHON_SPECIALIST: AgentRole = {
  name: "python-specialist",
  specialization: ["python", "code-quality", "libraries", "pythonic", "performance"],
  promptTemplate: `You are a Python expert analyzing memory quality from a Python development perspective.

Focus on:
- Python code quality and pythonic patterns
- Library usage and dependency management
- Performance optimization opportunities
- Python-specific anti-patterns and code smells
- Testing patterns and best practices

Analyze this memory for Python-specific insights, code quality, and implementation patterns.
Provide specific recommendations for Python code improvements.`,
  
  relevanceScoring: (memory: Memory): number => {
    const content = memory.content.toLowerCase();
    
    const pythonKeywords = [
      'python', 'pip', 'virtualenv', 'conda', 'pytest', 'django', 'flask',
      'numpy', 'pandas', 'asyncio', 'class', 'def ', 'import ', '__init__',
      '.py', 'pythonic', 'pep8', 'type hint', 'dataclass'
    ];
    
    const keywordMatches = pythonKeywords.filter(keyword => content.includes(keyword));
    const baseScore = Math.min(keywordMatches.length / 5, 1.0);
    
    // Boost for Python-related tags
    let tags: string[] = [];
    if (memory.metadata) {
      if (typeof memory.metadata === 'string') {
        try {
          tags = JSON.parse(memory.metadata).tags || [];
        } catch (e) {
          tags = [];
        }
      } else {
        tags = (memory.metadata as any).tags || [];
      }
    }
    const hasPythonTag = tags.some((tag: string) => tag.toLowerCase().includes('python'));
    
    return hasPythonTag ? Math.min(baseScore + 0.4, 1.0) : baseScore;
  }
};

// Research Specialist Agent - Focuses on knowledge gaps and cross-references
export const RESEARCH_SPECIALIST: AgentRole = {
  name: "research-specialist",
  specialization: ["research", "knowledge-gaps", "cross-reference", "documentation", "learning"],
  promptTemplate: `You are a research specialist analyzing memory quality from a knowledge management perspective.

Focus on:
- Knowledge gaps and missing information
- Cross-reference opportunities with other memories
- Documentation completeness and clarity
- Learning and research opportunities
- Information organization and accessibility

Analyze this memory for research insights, knowledge gaps, and cross-reference opportunities.
Provide specific recommendations for knowledge enhancement and organization.`,
  
  relevanceScoring: (memory: Memory): number => {
    const content = memory.content.toLowerCase();
    
    const researchKeywords = [
      'research', 'documentation', 'learn', 'study', 'investigate', 'explore',
      'reference', 'link', 'cross-reference', 'related', 'similar', 'compare',
      'knowledge', 'understanding', 'explanation', 'clarification', 'todo'
    ];
    
    const keywordMatches = researchKeywords.filter(keyword => content.includes(keyword));
    const baseScore = Math.min(keywordMatches.length / 5, 1.0);
    
    // Boost for reference or documentation type memories  
    const memoryType = (memory as any).type;
    const isReference = memoryType === 'reference' || content.includes('http');
    
    return isReference ? Math.min(baseScore + 0.3, 1.0) : baseScore;
  }
};

// ============================================
// Enhanced Consensus Engine with Weighted Voting
// 
// ACKNOWLEDGMENT: Consensus patterns inspired by zen-mcp-server
// https://github.com/jray2123/zen-mcp-server/blob/main/tools/consensus.py
// Key learnings: stance injection, balanced analysis, sequential consultation
// ============================================

interface WeightedAnalysis extends AgentAnalysis {
  domainWeight: number;
  expertiseBonus: number;
}

interface DebateRound {
  agentName: string;
  stance: 'keep' | 'delete' | 'neutral';
  response: string;
  addressedConcerns: string[];
  counterarguments: string[];
}

interface StanceConfiguration {
  agentRole: string;
  stance: 'keep' | 'delete' | 'neutral';
  stancePrompt?: string;
}

interface EnhancedConsensusResult extends ConsensusResult {
  debateRounds: DebateRound[];
  expertiseWeights: Record<string, number>;
  conflictResolution: string;
  requiresHumanReview: boolean;
}

export class ConsensusEngine {
  
  /**
   * Calculate enhanced weighted consensus with stance-based debate
   */
  async calculateEnhancedConsensus(
    analyses: AgentAnalysis[], 
    memory: Memory,
    enableDebate: boolean = false
  ): Promise<EnhancedConsensusResult> {
    // Calculate domain-specific weights based on agent relevance
    const weightedAnalyses: WeightedAnalysis[] = analyses.map(analysis => {
      const domainWeight = this.calculateDomainWeight(analysis.agentRole, memory);
      const expertiseBonus = this.calculateExpertiseBonus(analysis);
      
      return {
        ...analysis,
        domainWeight,
        expertiseBonus
      };
    });

    // Calculate weighted voting scores
    const totalWeight = weightedAnalyses.reduce((sum, wa) => sum + wa.domainWeight + wa.expertiseBonus, 0);
    const weightedKeepScore = weightedAnalyses.reduce((sum, wa) => {
      const weight = (wa.domainWeight + wa.expertiseBonus) / totalWeight;
      return sum + (wa.deleteRecommendation ? 0 : weight * wa.confidenceScore);
    }, 0);

    const weightedDeleteScore = weightedAnalyses.reduce((sum, wa) => {
      const weight = (wa.domainWeight + wa.expertiseBonus) / totalWeight;
      return sum + (wa.deleteRecommendation ? weight * wa.confidenceScore : 0);
    }, 0);

    const finalDecision = weightedKeepScore > weightedDeleteScore;
    const consensusConfidence = Math.abs(weightedKeepScore - weightedDeleteScore);
    
    // Calculate agreement level with weighted voting
    const majorityDecision = finalDecision;
    const agreementCount = weightedAnalyses.filter(wa => wa.deleteRecommendation !== majorityDecision).length;
    const agreementLevel = 1 - (agreementCount / analyses.length);

    // Determine if human review is needed
    const requiresHumanReview = consensusConfidence < 0.3 || agreementLevel < 0.6;

    // Extract minority views
    const minorityViews = weightedAnalyses
      .filter(wa => wa.deleteRecommendation !== majorityDecision)
      .map(wa => `${wa.agentRole}: ${wa.deleteRecommendation ? 'DELETE' : 'KEEP'} (confidence: ${wa.confidenceScore})`)
      .slice(0, 3);

    // Build expertise weights map
    const expertiseWeights: Record<string, number> = {};
    weightedAnalyses.forEach(wa => {
      expertiseWeights[wa.agentRole] = wa.domainWeight + wa.expertiseBonus;
    });

    // Run debate phase if enabled and there's disagreement
    let debateRounds: DebateRound[] = [];
    if (enableDebate && agreementLevel < 0.8) {
      debateRounds = await this.conductStanceBasedDebate(weightedAnalyses, memory);
    }

    return {
      finalDecision,
      consensusConfidence,
      agreementLevel,
      weightedScore: weightedKeepScore,
      minorityViews,
      debateRounds,
      expertiseWeights,
      conflictResolution: requiresHumanReview ? 'human-review-required' : 'automated-consensus',
      requiresHumanReview
    };
  }

  /**
   * Conduct structured debate between agents with opposing stances
   * Inspired by zen-mcp-server's stance injection approach
   */
  private async conductStanceBasedDebate(
    analyses: WeightedAnalysis[], 
    memory: Memory
  ): Promise<DebateRound[]> {
    const debateRounds: DebateRound[] = [];
    
    // Create stance configurations - force opposing views
    const stanceConfigs: StanceConfiguration[] = [
      { agentRole: 'general-curator', stance: 'keep', stancePrompt: 'Argue FOR keeping this memory, finding its BEST possible value IF it has merit. Acknowledge legitimate concerns but focus on preservation arguments.' },
      { agentRole: 'security-specialist', stance: 'delete', stancePrompt: 'Argue FOR deletion if security concerns exist. Being thorough means identifying the WORST potential risks, not blindly opposing. Acknowledge any security benefits.' },
      { agentRole: 'architecture-specialist', stance: 'neutral', stancePrompt: 'Provide balanced architectural assessment. Weigh preservation value against technical debt concerns equally.' }
    ];

    // Simulate debate rounds (in real implementation, would call AI models)
    for (const config of stanceConfigs) {
      const analysis = analyses.find(a => a.agentRole === config.agentRole);
      if (analysis) {
        debateRounds.push({
          agentName: config.agentRole,
          stance: config.stance,
          response: `[Stance: ${config.stance.toUpperCase()}] Based on ${analysis.findings.length} findings...`,
          addressedConcerns: analysis.findings.map(f => f.description).slice(0, 2),
          counterarguments: [`Acknowledged: ${config.stance === 'keep' ? 'deletion risks' : 'preservation value'}`]
        });
      }
    }

    return debateRounds;
  }

  /**
   * Calculate domain-specific weight for an agent based on memory content
   */
  private calculateDomainWeight(agentRole: string, memory: Memory): number {
    const agents = [GENERAL_CURATOR, SECURITY_SPECIALIST, ARCHITECTURE_SPECIALIST, PYTHON_SPECIALIST, RESEARCH_SPECIALIST];
    const agent = agents.find(a => a.name === agentRole);
    return agent ? agent.relevanceScoring(memory) : 0.1;
  }

  /**
   * Calculate expertise bonus based on agent confidence and findings quality
   */
  private calculateExpertiseBonus(analysis: AgentAnalysis): number {
    // Higher confidence and more findings indicate higher expertise
    const confidenceBonus = analysis.confidenceScore * 0.3;
    const findingsBonus = Math.min(analysis.findings.length * 0.1, 0.2);
    return confidenceBonus + findingsBonus;
  }

  /**
   * Legacy method for backward compatibility
   */
  calculateWeightedConsensus(analyses: AgentAnalysis[]): ConsensusResult {
    if (analyses.length === 0) {
      throw new Error('Cannot calculate consensus with no analyses');
    }
    
    if (analyses.length === 1) {
      // Single agent - return as consensus
      const agent = analyses[0];
      return {
        finalDecision: agent.deleteRecommendation,
        consensusConfidence: agent.confidenceScore * agent.relevanceScore,
        agreementLevel: 1.0,
        weightedScore: agent.confidenceScore,
        minorityViews: [],
        requiresHumanReview: agent.confidenceScore < 0.7
      };
    }
    
    // Multi-agent consensus calculation
    const totalWeight = analyses.reduce((sum, analysis) => sum + analysis.relevanceScore, 0);
    
    if (totalWeight === 0) {
      throw new Error('Cannot calculate consensus with zero total relevance weight');
    }
    
    // Weighted voting for final decision
    const weightedVotes = analyses.reduce((sum, analysis) => {
      const weight = analysis.relevanceScore / totalWeight;
      return sum + (analysis.deleteRecommendation ? weight : 0);
    }, 0);
    
    const finalDecision = weightedVotes > 0.5;
    
    // Calculate agreement level
    const agreeingAgents = analyses.filter(a => a.deleteRecommendation === finalDecision);
    const agreementLevel = agreeingAgents.length / analyses.length;
    
    // Weighted confidence score using geometric mean of confidence * relevance
    const weightedConfidences = analyses.map(a => 
      Math.pow(a.confidenceScore * a.relevanceScore, a.relevanceScore / totalWeight)
    );
    const consensusConfidence = weightedConfidences.reduce((product, conf) => product * conf, 1);
    
    // Weighted average score
    const weightedScore = analyses.reduce((sum, analysis) => {
      const weight = analysis.relevanceScore / totalWeight;
      return sum + (analysis.confidenceScore * weight);
    }, 0);
    
    // Collect minority views
    const minorityAgents = analyses.filter(a => a.deleteRecommendation !== finalDecision);
    const minorityViews = minorityAgents.map(agent => 
      `${agent.agentRole}: ${agent.reasoning}`
    );
    
    // Human review required if low consensus confidence or low agreement
    const requiresHumanReview = consensusConfidence < 0.7 || agreementLevel < 0.6;
    
    return {
      finalDecision,
      consensusConfidence,
      agreementLevel,
      weightedScore,
      minorityViews,
      requiresHumanReview
    };
  }
}

// ============================================
// Multi-AI Analyzer Tool
// ============================================

export class MultiAIAnalyzeMemoryQualityTool extends BaseMCPTool {
  private singleAITool: AnalyzeMemoryQualityTool;
  private consensusEngine: ConsensusEngine;
  private enableABTesting: boolean;
  
  constructor(dbService: any, enableABTesting = true) {
    super(dbService);
    this.singleAITool = new AnalyzeMemoryQualityTool(dbService);
    this.consensusEngine = new ConsensusEngine();
    this.enableABTesting = enableABTesting;
  }
  
  async handle(params: QualityAnalysisParams = {}): Promise<MCPResponse> {
    const startTime = Date.now();
    
    try {
      // Get memories to analyze (reuse existing logic)
      const memoriesToAnalyze = await this.getMemoriesToAnalyze(params);
      
      if (memoriesToAnalyze.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'No memories found to analyze',
              ...params
            }, null, 2)
          }]
        };
      }
      
      // Run multi-AI analysis on each memory
      const multiAIAnalyses: MultiAIAnalysis[] = [];
      for (const memory of memoriesToAnalyze) {
        const analysis = await this.analyzeMemoryWithMultiAI(memory, params);
        multiAIAnalyses.push(analysis);
      }
      
      // Generate comparison report
      const report = this.generateMultiAIReport(multiAIAnalyses, memoriesToAnalyze.length);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(report, null, 2)
        }]
      };
      
    } catch (error) {
      return this.handleError(error, 'Multi-AI memory quality analysis failed');
    }
  }
  
  private async getMemoriesToAnalyze(params: QualityAnalysisParams): Promise<Memory[]> {
    const { memoryId, limit = 50 } = params;
    
    if (memoryId) {
      const memory = await this.dbService.getMemory(memoryId);
      return memory ? [memory] : [];
    } else {
      return await this.dbService.getDevMemories(limit);
    }
  }
  
  private async analyzeMemoryWithMultiAI(
    memory: Memory, 
    params: QualityAnalysisParams
  ): Promise<MultiAIAnalysis> {
    const startTime = Date.now();
    
    // Run single-AI analysis for comparison (if A/B testing enabled)
    let singleAIComparison: MemoryQualityAnalysis | undefined;
    if (this.enableABTesting) {
      const singleAIResponse = await this.singleAITool.handle({ 
        memoryId: memory.memory_id,
        ...params 
      });
      // Extract single AI results (would need to parse from response)
      // For now, skipping to focus on multi-AI implementation
    }
    
    // Run multi-agent analysis with all 5 agents
    const agents = [GENERAL_CURATOR, SECURITY_SPECIALIST, ARCHITECTURE_SPECIALIST, PYTHON_SPECIALIST, RESEARCH_SPECIALIST];
    const agentAnalyses: AgentAnalysis[] = [];
    
    // Dynamic agent selection based on relevance and cost optimization
    const selectedAgents = this.selectRelevantAgents(agents, memory, params);
    
    for (const agent of selectedAgents) {
      const relevance = agent.relevanceScoring(memory);
      const analysis = await this.runAgentAnalysis(memory, agent, params);
      agentAnalyses.push(analysis);
    }
    
    // Calculate consensus
    const consensus = this.consensusEngine.calculateWeightedConsensus(agentAnalyses);
    
    // Merge issues from all agents
    const mergedIssues = this.mergeAgentIssues(agentAnalyses);
    
    // Calculate overall quality score (weighted average of agent scores)
    const qualityScore = Math.round(consensus.weightedScore * 100);
    
    const processingTime = Date.now() - startTime;
    
    return {
      memoryId: memory.memory_id,
      qualityScore,
      issues: mergedIssues,
      lastAnalyzed: new Date(),
      agentAnalyses,
      consensus,
      singleAIComparison,
      processingTimeMs: processingTime
    };
  }
  
  private async runAgentAnalysis(
    memory: Memory,
    agent: AgentRole,
    params: QualityAnalysisParams
  ): Promise<AgentAnalysis> {
    const relevance = agent.relevanceScoring(memory);
    
    // Skip low-relevance agents to save processing
    if (relevance < 0.1) {
      return {
        agentRole: agent.name,
        confidenceScore: 0.1,
        relevanceScore: relevance,
        findings: [],
        deleteRecommendation: false,
        reasoning: "Skipped due to low relevance",
        specializedInsights: []
      };
    }
    
    // Use zen-mcp-server chat tool for real analysis
    const analysisPrompt = this.buildAgentPrompt(memory, agent, params);
    
    try {
      const result = await this.callAgentModel(analysisPrompt, agent.name);
      return this.parseAgentResponse(result, agent.name, relevance);
    } catch (error) {
      console.error(`Agent ${agent.name} analysis failed:`, error);
      // Fallback to minimal analysis
      return {
        agentRole: agent.name,
        confidenceScore: 0.3,
        relevanceScore: relevance,
        findings: [{
          type: 'analysis-error',
          severity: 'low',
          description: `Analysis failed: ${String(error)}`,
          suggestion: 'Manual review recommended'
        }],
        deleteRecommendation: false,
        reasoning: "Analysis failed - manual review needed",
        specializedInsights: []
      };
    }
  }
  
  /**
   * Build specialized prompt for each agent focusing on knowledge enhancement
   */
  private buildAgentPrompt(memory: Memory, agent: AgentRole, params: QualityAnalysisParams): string {
    const memoryPreview = memory.content.substring(0, 2000);
    const memoryType = (memory as any).content_type || 'unknown';
    
    let metadata = '';
    if (memory.metadata) {
      try {
        const meta = typeof memory.metadata === 'string' ? JSON.parse(memory.metadata) : memory.metadata;
        metadata = JSON.stringify(meta, null, 2);
      } catch (e) {
        metadata = 'Metadata parsing failed';
      }
    }
    
    const baseContext = `
MEMORY ANALYSIS TASK:
Memory ID: ${memory.memory_id}
Type: ${memoryType}
Content Length: ${memory.content.length} characters
Metadata: ${metadata}

MEMORY CONTENT:
${memoryPreview}${memory.content.length > 2000 ? '\n...[TRUNCATED]' : ''}

ANALYSIS OBJECTIVE: ${agent.promptTemplate}

REQUIRED OUTPUT FORMAT:
Provide analysis as JSON with these fields:
{
  "confidenceScore": 0.0-1.0,
  "deleteRecommendation": boolean,
  "reasoning": "detailed explanation of your assessment",
  "findings": [
    {
      "type": "gap|enhancement|pattern|risk|connection",
      "severity": "critical|high|medium|low", 
      "description": "specific finding",
      "suggestion": "actionable recommendation"
    }
  ],
  "specializedInsights": [
    "insight 1: specific knowledge management recommendation",
    "insight 2: cross-reference or pattern identification"
  ]
}

Focus on ACTIONABLE INSIGHTS for knowledge enhancement, not just quality assessment.`;

    return baseContext;
  }
  
  /**
   * Call AI model using available tools (zen-mcp-server integration)
   */
  private async callAgentModel(prompt: string, agentName: string): Promise<string> {
    // For now, simulate calling a model - in real implementation this would use:
    // - zen-mcp-server chat tool
    // - direct OpenAI/Anthropic API calls
    // - or local model inference
    
    // Simulate realistic analysis based on agent specialization
    return this.simulateAgentAnalysis(prompt, agentName);
  }
  
  /**
   * Simulate realistic agent analysis for development/testing
   */
  private simulateAgentAnalysis(prompt: string, agentName: string): string {
    const content = prompt.match(/MEMORY CONTENT:\s*(.*?)(?=\n\nANALYSIS OBJECTIVE:|$)/s)?.[1] || '';
    
    // Generate realistic responses based on content and agent type
    const insights = [];
    const findings = [];
    
    if (agentName === 'general-curator') {
      if (content.includes('TODO') || content.includes('TDD') || content.includes('PLAN')) {
        findings.push({
          type: "enhancement",
          severity: "medium",
          description: "Implementation plan detected with potential knowledge gaps",
          suggestion: "Consider adding progress tracking and lessons learned section"
        });
        insights.push("Cross-reference with related implementation memories for pattern analysis");
      }
      
      if (content.includes('CRITICAL') || content.includes('FAILURE')) {
        findings.push({
          type: "pattern",
          severity: "high", 
          description: "Critical failure analysis - valuable for pattern extraction",
          suggestion: "Tag for cross-project learning and create failure pattern template"
        });
        insights.push("High-value incident documentation suitable for knowledge base");
      }
    }
    
    if (agentName === 'security-specialist') {
      if (content.includes('backup') || content.includes('zfs')) {
        findings.push({
          type: "gap",
          severity: "medium",
          description: "Backup implementation lacks security considerations documentation", 
          suggestion: "Add encryption, access control, and audit logging documentation"
        });
        insights.push("Backup security practices should be documented for compliance");
      }
    }
    
    if (agentName === 'architecture-specialist') {
      if (content.includes('architecture') || content.includes('design')) {
        findings.push({
          type: "enhancement",
          severity: "medium",
          description: "Architecture documentation could benefit from diagrams and decision rationale",
          suggestion: "Add architectural decision records (ADRs) and system diagrams"
        });
        insights.push("Consider creating architecture templates from successful patterns");
      }
    }
    
    if (agentName === 'research-specialist') {
      if (content.length > 1000) {
        findings.push({
          type: "connection",
          severity: "low",
          description: "Comprehensive documentation with potential cross-reference opportunities",
          suggestion: "Identify related memories and create knowledge cluster mappings"
        });
        insights.push("Rich content suitable for knowledge graph connections");
      }
    }
    
    if (agentName === 'python-specialist') {
      if (content.includes('python') || content.includes('.py') || content.includes('import')) {
        findings.push({
          type: "enhancement",
          severity: "medium",
          description: "Python implementation could benefit from code examples and patterns",
          suggestion: "Add code snippets, error handling patterns, and testing approaches"
        });
        insights.push("Python code patterns suitable for template extraction");
      }
    }
    
    // Determine delete recommendation (conservative - only for truly redundant content)
    const deleteRecommendation = content.length < 100 && !content.includes('CRITICAL') && !content.includes('TODO');
    
    const response = {
      confidenceScore: 0.7 + Math.random() * 0.2, // 0.7-0.9
      deleteRecommendation,
      reasoning: `${agentName} analysis: ${findings.length > 0 ? 'Found actionable enhancement opportunities' : 'Content appears complete but could benefit from knowledge connections'}`,
      findings,
      specializedInsights: insights
    };
    
    return JSON.stringify(response, null, 2);
  }
  
  /**
   * Parse agent response into structured format
   */
  private parseAgentResponse(response: string, agentName: string, relevance: number): AgentAnalysis {
    try {
      const parsed = JSON.parse(response);
      
      return {
        agentRole: agentName,
        confidenceScore: parsed.confidenceScore || 0.5,
        relevanceScore: relevance,
        findings: parsed.findings || [],
        deleteRecommendation: parsed.deleteRecommendation || false,
        reasoning: parsed.reasoning || 'No reasoning provided',
        specializedInsights: parsed.specializedInsights || []
      };
    } catch (error) {
      // Fallback parsing for malformed responses
      return {
        agentRole: agentName,
        confidenceScore: 0.3,
        relevanceScore: relevance,
        findings: [{
          type: 'parsing-error',
          severity: 'low',
          description: 'Failed to parse agent response',
          suggestion: 'Manual review recommended'
        }],
        deleteRecommendation: false,
        reasoning: "Response parsing failed",
        specializedInsights: []
      };
    }
  }
  
  private generateMultiAIReport(analyses: MultiAIAnalysis[], totalMemories: number) {
    const avgProcessingTime = analyses.reduce((sum, a) => sum + a.processingTimeMs, 0) / analyses.length;
    const consensusStats = this.calculateConsensusStats(analyses);
    
    return {
      summary: {
        memoriesAnalyzed: analyses.length,
        totalMemories,
        averageProcessingTimeMs: Math.round(avgProcessingTime),
        multiAIConsensusStats: consensusStats
      },
      analyses: analyses,
      metadata: {
        toolVersion: "multi-ai-v1.0",
        timestamp: new Date().toISOString(),
        agentsUsed: ["general-curator", "security-specialist"]
      }
    };
  }
  
  private calculateConsensusStats(analyses: MultiAIAnalysis[]) {
    const consensuses = analyses.map(a => a.consensus);
    
    return {
      averageConsensusConfidence: consensuses.reduce((sum, c) => sum + c.consensusConfidence, 0) / consensuses.length,
      averageAgreementLevel: consensuses.reduce((sum, c) => sum + c.agreementLevel, 0) / consensuses.length,
      humanReviewRequired: consensuses.filter(c => c.requiresHumanReview).length,
      unanimousDecisions: consensuses.filter(c => c.agreementLevel === 1.0).length
    };
  }

  /**
   * Dynamic agent selection based on memory content and cost optimization
   * Inspired by zen-mcp-server's relevance-based consultation
   */
  private selectRelevantAgents(
    agents: AgentRole[], 
    memory: Memory, 
    params: QualityAnalysisParams
  ): AgentRole[] {
    // Calculate relevance scores for all agents
    const agentRelevance = agents.map(agent => ({
      agent,
      relevance: agent.relevanceScoring(memory)
    }));

    // Sort by relevance
    agentRelevance.sort((a, b) => b.relevance - a.relevance);

    // Always include general curator (baseline)
    const selected = [GENERAL_CURATOR];

    // Add highly relevant specialists (relevance > 0.3)
    const specialists = agentRelevance
      .filter(ar => ar.agent !== GENERAL_CURATOR && ar.relevance > 0.3)
      .map(ar => ar.agent);

    selected.push(...specialists);

    // Ensure minimum 2 agents for consensus, maximum 4 for cost control
    if (selected.length < 2) {
      // Add highest relevance specialist if we only have general curator
      const topSpecialist = agentRelevance.find(ar => ar.agent !== GENERAL_CURATOR);
      if (topSpecialist) {
        selected.push(topSpecialist.agent);
      }
    }

    // Limit to top 4 agents for cost control
    return selected.slice(0, 4);
  }

  /**
   * Merge issues from multiple agents, deduplicating and aggregating
   */
  private mergeAgentIssues(analyses: AgentAnalysis[]): MemoryQualityIssue[] {
    const issueMap = new Map<string, MemoryQualityIssue>();
    
    for (const analysis of analyses) {
      for (const issue of analysis.findings) {
        const key = `${issue.type}-${issue.description}`;
        
        if (issueMap.has(key)) {
          // Issue already exists - increase severity if multiple agents found it
          const existing = issueMap.get(key)!;
          if (this.getSeverityWeight(issue.severity) > this.getSeverityWeight(existing.severity)) {
            existing.severity = issue.severity;
          }
        } else {
          issueMap.set(key, { ...issue });
        }
      }
    }
    
    return Array.from(issueMap.values());
  }
  
  private getSeverityWeight(severity: string): number {
    switch (severity) {
      case 'critical': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }
}