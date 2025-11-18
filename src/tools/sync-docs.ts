// Sync Documentation Tool
// Author: PB and Claude
// Date: 2025-11-18
// Syncs markdown documentation from ~/docs and project docs/ to lessons_learned_docs table

import { BaseMCPTool, MCPResponse } from './base-tool.js';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

export interface SyncDocsParams {
  directories?: string[];  // Optional: override default directories
  forceUpdate?: boolean;   // Re-ingest even if unchanged
}

interface DocumentFile {
  filepath: string;
  filename: string;
  content: string;
  mtime: Date;
  doc_hash: string;
  doc_id: string;
}

interface ChangeDetection {
  new: DocumentFile[];
  updated: DocumentFile[];
  unchanged: DocumentFile[];
}

export class SyncDocsTool extends BaseMCPTool<SyncDocsParams> {
  constructor(dbService: any) {
    super(dbService);
  }

  async handle(params: SyncDocsParams): Promise<MCPResponse> {
    try {
      const { directories, forceUpdate = false } = params;

      // Step 1: Discover markdown files
      const dirs = directories || this.getDefaultDirectories();
      const files = await this.discoverMarkdownFiles(dirs);

      if (files.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No markdown files found in:\\n' + dirs.map(d => `  - ${d}`).join('\\n')
          }]
        };
      }

      // Step 2: Detect changes (new, updated, unchanged)
      const changes = await this.detectChanges(files, forceUpdate);

      if (changes.new.length === 0 && changes.updated.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `All ${files.length} documents are up to date. No changes to sync.`
          }]
        };
      }

      // Step 3: Ingest new and updated documents
      const results = await this.ingestDocuments([...changes.new, ...changes.updated]);

      // Step 4: Return summary
      return {
        content: [{
          type: 'text',
          text: this.formatSummary(changes, results, dirs)
        }]
      };

    } catch (error) {
      return this.handleError(error, 'sync-docs');
    }
  }

  private getDefaultDirectories(): string[] {
    const dirs: string[] = [];

    // Always include $HOME/docs
    const homeDocsDir = join(homedir(), 'docs');
    if (existsSync(homeDocsDir)) {
      dirs.push(homeDocsDir);
    }

    // Include current project docs/ if it exists
    const projectDocsDir = join(process.cwd(), 'docs');
    if (existsSync(projectDocsDir) && projectDocsDir !== homeDocsDir) {
      dirs.push(projectDocsDir);
    }

    return dirs;
  }

  private async discoverMarkdownFiles(directories: string[]): Promise<DocumentFile[]> {
    const files: DocumentFile[] = [];

    for (const dir of directories) {
      if (!existsSync(dir)) {
        continue;
      }

      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.md')) {
          continue;
        }

        const filepath = join(dir, entry);
        const stats = statSync(filepath);

        if (!stats.isFile()) {
          continue;
        }

        const content = readFileSync(filepath, 'utf-8');
        const doc_hash = this.blake3Hash(content);
        const doc_id = this.blake3Hash(filepath);

        files.push({
          filepath,
          filename: basename(filepath),
          content,
          mtime: stats.mtime,
          doc_hash,
          doc_id
        });
      }
    }

    return files;
  }

  private async detectChanges(files: DocumentFile[], forceUpdate: boolean): Promise<ChangeDetection> {
    const changes: ChangeDetection = {
      new: [],
      updated: [],
      unchanged: []
    };

    // Get existing docs from database
    const existingDocs = await this.dbService.db.all(
      'SELECT doc_id, filepath, doc_hash, file_mtime FROM lessons_learned_docs'
    );

    const existingMap = new Map(existingDocs.map((d: any) => [d.filepath, d]));

    for (const file of files) {
      const existing = existingMap.get(file.filepath);

      if (!existing) {
        // New file
        changes.new.push(file);
      } else if (forceUpdate || file.doc_hash !== existing.doc_hash) {
        // Updated file (content changed)
        changes.updated.push(file);
      } else {
        // Unchanged
        changes.unchanged.push(file);
      }
    }

    return changes;
  }

  private async ingestDocuments(docs: DocumentFile[]): Promise<number> {
    let count = 0;

    for (const doc of docs) {
      // Count words for metadata
      const wordCount = doc.content.split(/\\s+/).length;

      // Upsert document (INSERT ON CONFLICT UPDATE)
      await this.dbService.db.run(
        `INSERT INTO lessons_learned_docs (doc_id, filename, filepath, content, file_mtime, doc_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, json(?))
         ON CONFLICT(filepath) DO UPDATE SET
           content = excluded.content,
           file_mtime = excluded.file_mtime,
           doc_hash = excluded.doc_hash,
           metadata = excluded.metadata`,
        [
          doc.doc_id,
          doc.filename,
          doc.filepath,
          doc.content,
          doc.mtime.toISOString(),
          doc.doc_hash,
          JSON.stringify({ word_count: wordCount })
        ]
      );

      count++;
    }

    return count;
  }

  private formatSummary(changes: ChangeDetection, ingested: number, dirs: string[]): string {
    const lines: string[] = [];

    lines.push('✅ Documentation sync complete\\n');

    lines.push('Scanned directories:');
    for (const dir of dirs) {
      lines.push(`  - ${dir}`);
    }
    lines.push('');

    lines.push('Results:');
    lines.push(`  📄 Total files found: ${changes.new.length + changes.updated.length + changes.unchanged.length}`);
    lines.push(`  ✨ New documents: ${changes.new.length}`);
    lines.push(`  🔄 Updated documents: ${changes.updated.length}`);
    lines.push(`  ✓  Unchanged: ${changes.unchanged.length}`);
    lines.push('');

    if (changes.new.length > 0) {
      lines.push('New documents:');
      for (const doc of changes.new.slice(0, 10)) {
        lines.push(`  + ${doc.filename}`);
      }
      if (changes.new.length > 10) {
        lines.push(`  ... and ${changes.new.length - 10} more`);
      }
      lines.push('');
    }

    if (changes.updated.length > 0) {
      lines.push('Updated documents:');
      for (const doc of changes.updated.slice(0, 10)) {
        lines.push(`  ↻ ${doc.filename}`);
      }
      if (changes.updated.length > 10) {
        lines.push(`  ... and ${changes.updated.length - 10} more`);
      }
      lines.push('');
    }

    lines.push(`Ingested ${ingested} documents to database.`);
    lines.push('');
    lines.push('📝 Next step: Extract insights from new documents using memory extraction workflow.');

    return lines.join('\\n');
  }

  private blake3Hash(input: string): string {
    // Using sha256 for now since Node.js doesn't have blake3 built-in
    // TODO: Add blake3 npm package later for better performance
    return createHash('sha256').update(input).digest('hex');
  }
}
