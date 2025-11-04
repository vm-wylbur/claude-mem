# Process Single Lessons-Learned Document

## Usage

```
/process-doc path/to/document.md
```

## What This Does

Extracts structured learnings from a single document and stores them in claude-mem.

## Steps

### 1. Read the Document

```bash
# Open and read the full document
cat path/to/document.md
```

### 2. Analyze Structure

- Identify document type (post-mortem, timeline, discussion, notes)
- Note any clear sections (Root Cause, Lessons, Recommendations)
- Understand the main situation/problem

### 3. Extract Learnings

For each learning found:

**A. Search for duplicates:**
```
search-enhanced("relevant keywords")
```

**B. Store the memory:**
```javascript
store-dev-memory({
  type: "<appropriate-type>",
  content: "<specific learning>",
  project: "<inferred-project>",
  tags: ["lessons-learned", ...],
  metadata: {
    source_file: "path/to/document.md",
    date_learned: "<date>",
    context: "<situation>",
    ...
  }
})
```

**C. Note the memory hash returned**

### 4. Create Relationships

Search for related existing memories and note connections.

### 5. Provide Summary

Output extraction summary in format specified in CLAUDE.md.

### 6. Update Log

Append to `extraction-log.md`:

```markdown
## path/to/document.md - [date]
- Memories: [count]
- Types: [breakdown]
- Hashes: [list]
```

## Example Usage

```
User: /process-doc docs/bad-recovery-drive.md

Claude:
Reading docs/bad-recovery-drive.md...

This is a post-mortem about filesystem corruption in a carved HFS+ recovery volume.
Main situation: tar backup failed due to directory corruption, not hardware failure.

Extracting learnings...

[Shows progress as it extracts and stores]

✓ Stored 8 memories:
  - 2 decisions (fsck policy, backup acceptance)
  - 2 patterns (NTT copier design, carved volume behavior)
  - 2 mistakes (mount warning ignored, misdiagnosis)
  - 2 recommendations (add is_carved flag, pre-backup checks)

[Provides full extraction summary]
```

## Quality Checklist

Before finishing:
- [ ] All major learnings extracted
- [ ] Technical details preserved
- [ ] Context included
- [ ] Tags are specific
- [ ] Checked for duplicates
- [ ] Summary provided
- [ ] Log updated
