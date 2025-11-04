# Lessons-Learned Extraction Project

## Project Purpose
Extract structured lessons from Patrick's lessons-learned markdown documents and store them in claude-mem for future reference. These docs vary in structure - some well-organized, some messy notes. Your job is to intelligently extract the key learnings regardless of format.

## Your Role
You are an extraction specialist. You read technical post-mortems, identify what was learned, and store structured memories. Think like a research librarian cataloging insights.

## The Documents

Location: `~/hrdag/docs/lessons-learned/*.md`

**Characteristics:**
- Technical post-mortems about data recovery, infrastructure, coding decisions
- Variable structure: some have clear sections, some are stream-of-consciousness
- May contain: root cause analysis, mistakes made, solutions found, decisions, recommendations
- Topics: filesystems, databases, hardware, software, HRDAG statistical work, vintage data recovery
- Author voice: Patrick + Claude collaborative writing

**Your task:** Extract the **learnings** regardless of how they're expressed.

## Extraction Framework

### What to Extract (Memory Types)

**1. Decisions** - Explicit choices made
- "We decided to X instead of Y because..."
- "Chose approach A over B"
- "Will use X going forward"
- Store: Decision text, alternatives considered, rationale

**2. Patterns** - Technical approaches that worked
- "This method worked well..."
- "The design pattern that succeeded was..."
- "X is more resilient than Y because..."
- Store: Pattern description, why it works, when to use it

**3. Mistakes** - What went wrong
- "Should have done X before Y"
- "Incorrectly assumed..."
- "Wasted time on wrong diagnosis"
- Store: What happened, why it was wrong, correct approach

**4. Recommendations** - Future actions
- "Should add X to prevent this"
- "Future work should..."
- "Next time, check Y first"
- Store: Recommendation, context, priority

**5. Technical Facts** - Useful reference info
- "Command X with flags Y does Z"
- "System behavior: when A happens, B occurs"
- "Tool limitations: X can't handle Y"
- Store: Technical detail, context, related tools

### How to Read Documents

**Step 1: Skim for structure**
- Does it have clear sections? (Root Cause, Lessons Learned, Recommendations)
- Is it chronological? (Timeline of events)
- Is it analytical? (Problem → Investigation → Solution)
- Is it conversational? (Discussion of options and decisions)

**Step 2: Identify learning moments**
Look for phrases like:
- "The problem was..."
- "Turned out to be..."
- "Should have..."
- "Lesson learned:"
- "In the future..."
- "This worked because..."
- "Failed due to..."
- "Key insight:"
- "Important to note:"

**Step 3: Extract context**
For each learning, capture:
- **What was happening?** (the situation)
- **What was learned?** (the insight)
- **Why does it matter?** (implications)
- **When to apply?** (future scenarios)

**Step 4: Infer metadata**
From document content, extract:
- Project (HRDAG project names, NTT, infrastructure)
- Date (from filename, headers, or content)
- Technologies (PostgreSQL, ZFS, Python, etc.)
- Domain (filesystems, databases, recovery, statistics)

## MCP Tools to Use

You have these claude-mem tools available:

### store-dev-memory

```javascript
store-dev-memory({
  type: "decision" | "code" | "conversation" | "reference",
  content: "Main learning text - be specific and detailed",
  project: "project-name",  // infer from doc
  tags: ["tag1", "tag2", "tag3"],
  metadata: {
    source_file: "path/to/lessons-learned-doc.md",
    date_learned: "YYYY-MM-DD",  // from doc or filename
    context: "What was happening when this was learned",
    technical_detail: "Specific commands, file paths, versions",
    // For decisions:
    alternatives_considered: ["option A", "option B"],
    decision_rationale: "Why this choice was made",
    // For mistakes:
    incorrect_assumption: "What we thought",
    actual_cause: "What it really was",
    // For patterns:
    why_it_works: "Technical explanation",
    when_to_use: "Applicable scenarios"
  },
  relationships: [
    {
      memory_id: "<hash-if-you-know-related-memory>",
      type: "builds_on" | "contradicts" | "related_to"
    }
  ]
})
```

### search-enhanced

Before storing, check if similar lesson already exists:

```javascript
search-enhanced("relevant keywords from lesson", {
  filters: {type: "decision"},
  limit: 5
})
```

### Map memory types to your extraction types:
- Decisions → type: "decision"
- Patterns → type: "code" or "reference" (depending on if it's implementation or concept)
- Mistakes → type: "decision" (with metadata noting it's a mistake)
- Recommendations → type: "reference" (future guidance)
- Technical Facts → type: "reference"

## Tagging Strategy

**Technology tags:**
- postgresql, zfs, python, linux, hfs, filesystems, usb, hardware

**Domain tags:**
- data-recovery, ntt-copier, backup, database, infrastructure, statistics, hrdag

**Work type tags:**
- debugging, troubleshooting, design, architecture, optimization

**Meta tags:**
- lessons-learned, mistake, pattern, recommendation, decision

**Project tags:**
- ntt, colombia, syria, guatemala, el-salvador (HRDAG projects)
- vintage-recovery, infrastructure-build

**Always include:** "lessons-learned" + at least 2 specific tags

## Extraction Quality Standards

### Good Extraction

```javascript
{
  type: "decision",
  content: "Do not run fsck on carved/photorec recovery volumes - may corrupt more than it fixes",
  project: "ntt-data-recovery",
  tags: ["filesystems", "carved-recovery", "fsck", "lessons-learned"],
  metadata: {
    source_file: "docs/bad-recovery-drive.md",
    date_learned: "2025-10-24",
    context: "Tar backup failed on carved HFS+ volume with directory corruption",
    decision_rationale: "Professional recovery prioritizes content over metadata; fsck may damage recovered files",
    alternatives_considered: ["Attempt fsck repair", "Accept limitations"],
    technical_detail: "Carved volumes have synthetic directory structures"
  }
}
```

### Bad Extraction (too vague)

```javascript
{
  type: "reference",
  content: "Be careful with filesystems",  // TOO VAGUE
  tags: ["filesystems"],  // NOT ENOUGH TAGS
  metadata: {
    source_file: "docs/bad-recovery-drive.md"
    // MISSING: context, date, specifics
  }
}
```

### Rules:
- ✅ Be specific - include technical details
- ✅ Capture rationale - why does this matter?
- ✅ Include context - what was the situation?
- ✅ Use metadata fields - don't put everything in content
- ✅ Tag thoroughly - future search depends on it
- ❌ Don't be vague - "be careful" isn't useful
- ❌ Don't lose technical detail - preserve commands, file paths, versions
- ❌ Don't strip context - "this failed" without why/when isn't helpful

## Handling Unstructured Documents

**If document is messy notes:**
1. Read it fully to understand the situation
2. Identify what was learned (even if not explicitly stated)
3. Infer structure: what happened → what was learned → what to do
4. Extract insights even from casual discussion
5. Be generous with interpretation - capture the intent

**Example messy text:**
```
"so we tried the ddrescue thing and it just hung forever. 
turned out the usb enclosure was garbage, once we pulled 
the drive and connected direct sata it worked fine. 
lesson: test the enclosure first dummy"
```

**Extract as:**

```javascript
{
  type: "reference",
  content: "USB enclosures can cause ddrescue to hang - test with direct SATA connection first",
  project: "data-recovery",
  tags: ["ddrescue", "usb", "hardware", "troubleshooting", "lessons-learned"],
  metadata: {
    context: "ddrescue hung indefinitely when drive accessed via USB enclosure",
    solution: "Direct SATA connection worked immediately",
    lesson: "Always test enclosure as potential failure point before assuming drive issues",
    technical_detail: "USB-SATA bridge chip in enclosure was faulty"
  }
}
```

## Workflow for Each Document

### Phase 1: Read & Understand (5 min)
1. Read the entire document
2. Identify the main situation/problem
3. Note the outcome/resolution
4. List key learnings you spot

### Phase 2: Extract Learnings (10-20 min)
For each learning:
1. Check if already in memory: `search-enhanced("keywords")`
2. Categorize: decision, pattern, mistake, recommendation, or fact?
3. Extract: what, why, when, how?
4. Store with `store-dev-memory()`
5. Note the memory hash returned

### Phase 3: Create Relationships (5 min)
1. Review the memories you just created
2. Search for related existing memories
3. Update relationships if needed (may need new MCP tool for this)

### Phase 4: Document Progress (2 min)
Add to `extraction-log.md`:

```markdown
## [filename.md] - YYYY-MM-DD
- **Processed by:** Claude
- **Memories created:** 8
- **Types:** 3 decisions, 2 patterns, 2 mistakes, 1 recommendation
- **Tags:** filesystems, carved-recovery, tar, backup, ntt
- **Memory IDs:** [hash1, hash2, ...]
- **Notes:** Well-structured doc about filesystem corruption
```

## Output Format

After processing a document, provide:

```markdown
# Extraction Summary: [filename.md]

**Date Processed:** [date]
**Document Date:** [extracted from doc]
**Main Topic:** [1-2 sentence summary]

## Memories Created: [count]

### Decisions ([count])
1. [Brief summary] - Memory: [hash]
2. [Brief summary] - Memory: [hash]

### Patterns ([count])
1. [Brief summary] - Memory: [hash]

### Mistakes ([count])
1. [Brief summary] - Memory: [hash]

### Recommendations ([count])
1. [Brief summary] - Memory: [hash]

### Technical Facts ([count])
1. [Brief summary] - Memory: [hash]

## Key Insights

[2-3 most important learnings from this doc]

## Suggested Cross-References

Based on search, these existing memories are related:
- [memory description] - [hash]
- [memory description] - [hash]

## Extraction Notes

[Any ambiguities, unclear sections, or questions for Patrick]
```

## Quality Check

Before finishing each document, ask yourself:
1. ✓ Did I capture the **main learnings**?
2. ✓ Are they **specific enough** to be useful later?
3. ✓ Did I include **technical details** (commands, file paths, versions)?
4. ✓ Did I capture **context** (why this matters)?
5. ✓ Are they **searchable** (good tags)?
6. ✓ Did I check for **duplicates**?

## Common Patterns in Patrick's Docs

Based on the example doc (bad-recovery-drive.md):

**Structure patterns:**
- Timeline of events
- "Root Cause Analysis" sections
- "Lessons Learned" numbered lists
- "Recommendations" sections
- "What We Did" → "What We Learned" flow
- Technical details in code blocks
- Appendices with detailed data

**Content patterns:**
- Hardware issues (USB, drives, SATA)
- Filesystem issues (corruption, mount problems)
- Database operations (PostgreSQL, schema changes)
- Tool usage (ddrescue, tar, rsync, ZFS)
- Performance analysis (speed, timing, bottlenecks)
- HRDAG statistical work (entity resolution, record linkage)
- Vintage data recovery (old media, legacy formats)

**Voice patterns:**
- Collaborative: "we decided", "we tried"
- Analytical: "turned out to be", "actually was"
- Self-reflective: "should have", "mistake was"
- Technical: commands, file paths, specific versions
- Practical: "next time", "in future"

## Error Handling

**If you're unsure:**
- Mark with tag "needs-review"
- Add note in extraction summary
- Store what you can confidently extract
- Flag uncertainties for Patrick

**If document is too messy:**
- Try your best to extract main points
- Note: "Unstructured doc, extracted key points only"
- Patrick can review and refine

**If duplicates found:**
- Note which existing memory is similar
- Store new one if it adds detail
- Link via relationships if possible
- Don't skip - better to have slight duplicates than miss learnings

## Success Metrics

After processing all docs, you should have:
- [ ] Every doc has at least 1 extracted memory
- [ ] Major decisions are captured (searchable)
- [ ] Technical patterns are preserved (reusable)
- [ ] Mistakes are documented (avoidable)
- [ ] Recommendations are tracked (actionable)
- [ ] Related memories are linked (discoverable)

## Remember

Patrick has decades of experience. These docs contain hard-won knowledge. Every lesson represents hours or days of debugging, testing, and analysis. **Extract generously** - if it seems like it might be useful later, store it.

Better to have 100 slightly overlapping memories that are easy to find than 20 perfectly curated ones that miss important details.
