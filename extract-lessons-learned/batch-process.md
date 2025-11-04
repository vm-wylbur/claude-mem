# Batch Process Lessons-Learned Documents

## Usage

```
/batch-process
```

or

```
/batch-process path/to/directory
```

## What This Does

Processes all lessons-learned documents in a directory (defaults to `docs/`).

## Steps

### 1. Find Documents

```bash
find docs/ -name "*.md" -type f | sort
```

### 2. Check What's Been Processed

```bash
cat extraction-log.md
```

### 3. For Each Unprocessed Document

Run the equivalent of `/process-doc` on it:
- Read document
- Extract learnings
- Store in claude-mem
- Log results

### 4. Provide Summary

```markdown
# Batch Processing Summary

**Total documents:** [count]
**Already processed:** [count]
**Newly processed:** [count]
**Total memories created:** [count]

## Documents Processed

1. doc1.md - 5 memories
2. doc2.md - 8 memories
3. doc3.md - 3 memories

## Overall Statistics

- Decisions: [count]
- Patterns: [count]
- Mistakes: [count]
- Recommendations: [count]
- Technical Facts: [count]

## Most Common Tags

1. filesystems - [count]
2. postgresql - [count]
3. data-recovery - [count]

## Next Steps

All documents processed. You can now:
- Search memories: search-enhanced("topic")
- List by tag: list-memories-by-tag(["tag"])
- Review extractions: /review-extraction
```

## Options

Process only new documents:
```
/batch-process --new-only
```

Process specific topic:
```
/batch-process --topic="database"
```

Dry run (show what would be extracted without storing):
```
/batch-process --dry-run
```
