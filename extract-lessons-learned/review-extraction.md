# Review Extracted Memories

## Usage

```
/review-extraction [document-name]
```

## What This Does

Shows what memories were extracted from a document and allows quality review.

## Steps

### 1. Get Extraction Info

If document specified:
```
search-enhanced("", filters={
  metadata.source_file: "docs/[document-name].md"
})
```

If no document:
```bash
cat extraction-log.md | tail -n 20
```

### 2. Display Memories

For each memory, show:
- Type
- Content summary
- Tags
- Key metadata
- Memory hash

### 3. Quality Check

Ask Patrick:
- Are these accurate?
- Missing anything important?
- Too granular or too high-level?
- Should any be merged?
- Are tags appropriate?

### 4. Offer Actions

- Re-extract if quality issues
- Add additional memories if something missed
- Update tags if needed
- Link related memories

## Example

```
User: /review-extraction bad-recovery-drive

Claude:
Reviewing extractions from bad-recovery-drive.md...

Found 8 memories created on 2025-10-24:

### Decision Memories (2)

1. **Do not run fsck on carved volumes** [hash: abc123...]
   - Tags: filesystems, carved-recovery, fsck, lessons-learned
   - Rationale: May corrupt more than it fixes
   - Context: Professional recovery prioritizes content
   
2. **Accept partial tar backup** [hash: def456...]
   - Tags: backup, tar, carved-recovery, lessons-learned
   - Rationale: Content safe in by-hash, fsck risky
   - Context: 96% of data backed up, rest in by-hash

[continues for all 8...]

Quality Assessment:
✓ All major lessons captured
✓ Technical details preserved
✓ Good tag coverage
⚠ Could add more cross-references between related memories

Suggestions:
- Link "NTT copier pattern" → "tar enumeration failure"
- Consider extracting specific fsck command as separate reference

How does this look? Any refinements needed?
```
