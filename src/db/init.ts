import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ProjectRow {
    project_id: number;
    name: string;
    description: string | null;
    created_at: string;
    last_accessed: string;
}

export async function initializeDatabase(dbPath: string): Promise<Database.Database> {
    // Create database with explicit read/write mode
    const db = new Database(dbPath, { readonly: false });
    
    try {
        // Read and execute schema
        let schemaPath = path.join(__dirname, '..', 'schema.sql');
        console.error('Trying schema path:', schemaPath);
        
        // If schema doesn't exist at the first path, try the source directory
        if (!await fs.access(schemaPath).then(() => true).catch(() => false)) {
            schemaPath = path.join(__dirname, '..', '..', 'src', 'schema.sql');
            console.error('Trying alternate schema path:', schemaPath);
        }
        
        const schema = await fs.readFile(schemaPath, 'utf-8');
        console.error('Schema loaded, first 100 chars:', schema.slice(0, 100));
        db.exec(schema);
        console.error('Schema executed');
        
        // Create development project if it doesn't exist
        const createDevProject = db.prepare(`
            INSERT OR IGNORE INTO projects (name, description)
            VALUES (
                'memory-mcp-development',
                'Development history and decisions for the Memory MCP Server project'
            )
        `);
        
        createDevProject.run();
        
        // Add initial development memory
        const getDevProjectId = db.prepare('SELECT project_id FROM projects WHERE name = ?');
        const projectId = (getDevProjectId.get('memory-mcp-development') as ProjectRow)?.project_id;
        
        if (projectId) {
            const storeInitialMemory = db.prepare(`
                INSERT OR IGNORE INTO memories (project_id, content, content_type, metadata)
                VALUES (?, ?, ?, ?)
            `);
            
            storeInitialMemory.run(
                projectId,
                'Project initialized with SQLite database, TypeScript configuration, and basic MCP server structure. ' +
                'Using Ollama for embeddings with nomic-embed-text model (768 dimensions). ' +
                'Initial schema created with tables for projects, memories, embeddings, tags, and relationships.',
                'decision',
                JSON.stringify({
                    key_decisions: [
                        'Using better-sqlite3 for database operations',
                        'Ollama nomic-embed-text for embeddings',
                        'TypeScript with ES modules',
                        'MCP SDK 1.7.0'
                    ],
                    implementation_status: 'initialization',
                    date: new Date().toISOString()
                })
            );
        }
        
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
} 