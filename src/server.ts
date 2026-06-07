/*
Author: PB and Claude
Date: 2026-02-28
License: (c) HRDAG, 2025, GPL-2 or newer

---
claude-mem/src/server.ts
*/

// Content classifiers shared by the REST write path (index-http.ts):
// detectMemoryType picks a memory type from content; generateSmartTags derives
// auto-tags. These outlived the retired MCP server (issue #4) — they are the
// only survivors of the former tool-registry factories.

import { MemoryType } from './db/service.js';

export function detectMemoryType(content: string): MemoryType {
    const lowerContent = content.toLowerCase();

    const codePatterns = [
        /\b(function|class|interface|type|const|let|var|import|export|return)\s+/,
        /\b(async|await|promise|callback)\b/,
        /\.(js|ts|tsx|jsx|py|java|cpp|c|go|rs|php|rb|swift|kt)(\s|$)/,
        /```[\w]*\n/,
        /^\s*(\/\/|\/\*|\#|<!--)/m,
        /\b(git|npm|yarn|pip|cargo|maven|gradle)\s+/,
        /\bfix|bug|error|exception|debug|test|implement|refactor\b/
    ];

    const decisionPatterns = [
        /\b(decided|chose|selected|picked|opted|determined)\b/,
        /\b(decision|choice|option|alternative|approach)\b/,
        /\b(will use|going with|settling on|adopting)\b/,
        /\b(instead of|rather than|over|versus|vs\.)\b/,
        /\b(pros and cons|trade.?off|benefit|drawback)\b/
    ];

    const referencePatterns = [
        /https?:\/\/[^\s]+/,
        /\b(documentation|docs|readme|wiki|manual|guide)\b/,
        /\b(reference|link|url|source|article|blog|post)\b/,
        /\b(see also|refer to|check out|look at)\b/,
        /\b(api|sdk|library|framework|package|module)\s+(docs?|documentation)/
    ];

    const codeScore = codePatterns.reduce((score, pattern) => score + (pattern.test(content) ? 1 : 0), 0);
    const decisionScore = decisionPatterns.reduce((score, pattern) => score + (pattern.test(lowerContent) ? 1 : 0), 0);
    const referenceScore = referencePatterns.reduce((score, pattern) => score + (pattern.test(lowerContent) ? 1 : 0), 0);

    if (codeScore >= decisionScore && codeScore >= referenceScore && codeScore > 0) {
        return 'code';
    } else if (decisionScore >= referenceScore && decisionScore > 0) {
        return 'decision';
    } else if (referenceScore > 0) {
        return 'reference';
    }
    return 'conversation';
}

export async function generateSmartTags(content: string, type: MemoryType): Promise<string[]> {
    const tags: string[] = [];
    const lowerContent = content.toLowerCase();

    tags.push(type);

    const techPatterns: Record<string, RegExp> = {
        'typescript': /\b(typescript|\.ts|\.tsx)\b/,
        'javascript': /\b(javascript|\.js|\.jsx|node\.js)\b/,
        'react': /\b(react|jsx|component|hook|useState|useEffect)\b/,
        'database': /\b(database|db|sql|postgres|query|table)\b/,
        'api': /\b(api|endpoint|rest|graphql|http|request|response)\b/,
        'testing': /\b(test|spec|jest|mocha|cypress|unit test|integration)\b/,
        'git': /\b(git|commit|branch|merge|pull request|pr)\b/,
        'docker': /\b(docker|container|dockerfile|image)\b/,
        'mcp': /\b(mcp|model context protocol|tool|server)\b/
    };

    const actionPatterns: Record<string, RegExp> = {
        'bugfix': /\b(fix|bug|error|issue|problem|broken)\b/,
        'feature': /\b(new feature|add|implement|create|build)\b/,
        'refactor': /\b(refactor|cleanup|reorganize|improve)\b/,
        'performance': /\b(performance|optimize|speed|slow|fast)\b/,
        'security': /\b(security|auth|permission|vulnerability)\b/,
        'documentation': /\b(document|readme|comment|explain)\b/
    };

    for (const [tag, pattern] of Object.entries(techPatterns)) {
        if (pattern.test(lowerContent)) tags.push(tag);
    }
    for (const [tag, pattern] of Object.entries(actionPatterns)) {
        if (pattern.test(lowerContent)) tags.push(tag);
    }

    const { isValidTagName } = await import('./utils/hash.js');
    const validTags = tags.filter(tag => isValidTagName(tag));
    return [...new Set(validTags)].slice(0, 6);
}
