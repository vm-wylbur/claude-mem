# PB & The Claudes' Dev Base: Multi-Claude Team Vision

## Overview

A collaborative AI development team where specialized Claude instances share a unified knowledge base, enabling continuous context preservation, expertise sharing, and autonomous knowledge curation.

## Team Structure

### Core Development Claudes
- **shell-claude** - Terminal, system admin, DevOps, infrastructure, ZFS, PostgreSQL
- **python-dev-claude** - Python development, architecture, libraries, backend systems  
- **datascience-claude** - Data analysis, ML/AI, visualization, research, embeddings
- **web-dev-claude** - Frontend, backend, APIs, web technologies, React, Node.js
- **mobile-dev-claude** - iOS/Android, React Native, mobile-specific development

### Quality & Testing Claudes
- **unit-testing-claude** - Unit tests, TDD, mocking, test frameworks, Jest, pytest
- **integration-testing-claude** - System tests, E2E, CI/CD pipelines, Docker testing
- **black-box-testing-claude** - User testing, security testing, chaos engineering
- **performance-claude** - Benchmarking, profiling, optimization, load testing

### Specialized Support Claudes
- **curator-claude** - Memory management, knowledge organization, autonomous curation
- **architect-claude** - System design, technical decisions, code review, patterns
- **security-claude** - Security audits, vulnerability assessment, compliance
- **docs-claude** - Documentation, tutorials, knowledge transfer, API docs

## Shared Memory System Architecture

### Current Foundation ✅
- PostgreSQL + pgvector for semantic search
- SSH tunnel connectivity (snowl/snowball)
- Hash-based distributed IDs
- Multiple memory types: conversation, code, decision, reference
- 72+ memories with team knowledge

### Phase 1: Enhanced UX (Immediate Priority)
1. **Natural Language Storage** 🎯
   - `quick-store` tool for free-form text input
   - Auto-detection of memory type and metadata generation
   - Reduces cognitive load for rapid knowledge capture

2. **Context Awareness** 🧠
   - `get-recent-context` tool for last N memories across all types
   - Essential for Claude instance onboarding and continuity
   - Enables seamless handoffs between specialized Claudes

3. **Enhanced Search UX** ⚡
   - Similarity scores and result ranking display
   - Date range filtering for temporal search
   - Adjustable result limits for better information control

### Phase 2: Team Collaboration Features
- **Role-based memory tagging**: `#shell-claude #python-dev-claude #shared-solution`
- **Cross-domain linking**: Connect related memories across Claude specialties
- **Knowledge gap detection**: Identify missing expertise areas
- **Collaboration opportunities**: Suggest knowledge sharing between Claudes

### Phase 3: Autonomous Curation
- **curator-claude** operates independently with aggressive automation
- **Memory lifecycle management**: ephemeral → active → archived → deleted
- **Quality enhancement**: Research and enrich important memories
- **Deduplication**: Merge similar memories while preserving unique insights
- **Bug tracking integration**: Automatic bug resolution and archiving

## Curator-Claude Operating Principles

### Core Identity
```
You are Curator-Claude for "PB & The Claudes' Dev Base" - maintaining collective knowledge 
for a multi-Claude development team. Each Claude contributes domain expertise. Your role is 
to organize this knowledge for maximum team effectiveness.
```

### Operating Philosophy
- **PRESERVE**: Never delete unique technical solutions or hard-won insights
- **ENHANCE**: Enrich memories with cross-references and additional context  
- **ORGANIZE**: Create logical connections while removing redundancy
- **COLLABORATE**: Actively identify knowledge sharing opportunities
- **LIFECYCLE**: Manage ephemeral content according to retention policies

### Curation Tasks
**Daily (5-10 min):**
- Bug lifecycle management and resolution tracking
- Ephemeral memory cleanup and status updates
- Duplicate detection and merging

**Weekly (30+ min):**
- Knowledge enhancement and cross-referencing
- Quality improvement and standardization
- Gap analysis and collaboration suggestions

**Monthly (1+ hours):**
- Strategic analysis and learning reports
- Pattern identification and consolidation
- Archive management and cleanup

## Memory Organization System

### Tagging Strategy
- **Role Tags**: `#shell-claude #python-dev-claude #datascience-claude`
- **Domain Tags**: `#infrastructure #ml #security #testing #frontend`
- **Collaboration Tags**: `#cross-team #shared-solution #needs-review`
- **Lifecycle Tags**: `#active #archived #deprecated #team-decision`

### Retention Policies
- **Bugs (resolved)**: 30 days → archived
- **Temporary notes**: 7 days → deleted
- **In-progress work**: 30 days → review/archive
- **Archived memories**: 1 year → permanent deletion
- **Critical decisions**: Permanent retention

## Expected Benefits

### For PB
- Continuous context preservation across work sessions
- Reduced need to re-explain technical decisions
- Automatic knowledge organization and enhancement
- Pattern recognition across different problem domains

### For Claude Team
- Seamless collaboration between specialized instances
- Shared learning from each domain expert
- Reduced redundant problem-solving
- Collective intelligence greater than individual parts

### For Development Process
- Institutional memory that persists across projects
- Automatic bug tracking and resolution management
- Knowledge consolidation and gap identification
- Enhanced decision-making through historical context

## Implementation Roadmap

1. **Phase 1 (Immediate)**: Natural language storage, context awareness, enhanced search
2. **Phase 2 (Near-term)**: Team collaboration features and cross-domain linking
3. **Phase 3 (Future)**: Autonomous curator-claude with full lifecycle management

This vision transforms individual AI assistance into a **persistent, collaborative development team** with shared institutional knowledge and autonomous maintenance capabilities.
