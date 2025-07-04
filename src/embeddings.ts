import fetch from 'node-fetch';
import Database from 'better-sqlite3';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = 'nomic-embed-text';

export interface OllamaHealthInfo {
  connected: boolean;
  host: string;
  model: string;
  lastEmbeddingTest?: Date;
  error?: string;
}

export interface EmbeddingResponse {
    embedding: number[];
}

/**
 * Generate embeddings using Ollama's API
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        const response = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: MODEL,
                prompt: text
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to generate embedding: ${response.statusText}`);
        }

        const data = await response.json() as EmbeddingResponse;
        return data.embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
}

/**
 * Store an embedding in the database
 */
export function storeEmbedding(db: Database.Database, vector: number[]): number {
    const stmt = db.prepare(`
        INSERT INTO embeddings (vector, dimensions)
        VALUES (?, ?)
    `);

    // Convert vector to Buffer for BLOB storage
    const buffer = Buffer.from(new Float64Array(vector).buffer);
    const result = stmt.run(buffer, vector.length);

    return result.lastInsertRowid as number;
}

/**
 * Convert a stored embedding back to a vector
 */
export function bufferToVector(buffer: Buffer): number[] {
    const float64Array = new Float64Array(buffer.buffer, buffer.byteOffset, buffer.length / 8);
    return Array.from(float64Array);
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find similar memories using cosine similarity
 */
export function findSimilarMemories(
    db: Database.Database, 
    queryVector: number[], 
    limit: number = 5,
    similarityThreshold: number = 0.7
): { memoryId: number; similarity: number }[] {
    const memories = db.prepare(`
        SELECT m.memory_id, e.vector 
        FROM memories m
        JOIN embeddings e ON m.embedding_id = e.embedding_id
        WHERE e.vector IS NOT NULL
    `).all();

    const similarities = memories.map((memory: any) => ({
        memoryId: memory.memory_id,
        similarity: cosineSimilarity(queryVector, bufferToVector(memory.vector))
    }));

    return similarities
        .filter(s => s.similarity >= similarityThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
}

/**
 * Check Ollama health and model availability
 */
export async function checkOllamaHealth(): Promise<OllamaHealthInfo> {
    const healthInfo: OllamaHealthInfo = {
        connected: false,
        host: OLLAMA_HOST,
        model: MODEL
    };

    try {
        // Test basic connection
        const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Ollama not responding: ${response.statusText}`);
        }

        const data = await response.json() as any;
        const models = data.models || [];
        const hasModel = models.some((m: any) => m.name.includes(MODEL));

        if (!hasModel) {
            healthInfo.error = `Model ${MODEL} not found. Available models: ${models.map((m: any) => m.name).join(', ')}`;
            return healthInfo;
        }

        // Test embedding generation with a simple phrase
        try {
            await generateEmbedding('test');
            healthInfo.connected = true;
            healthInfo.lastEmbeddingTest = new Date();
        } catch (embeddingError) {
            healthInfo.error = `Embedding test failed: ${embeddingError}`;
        }

    } catch (error) {
        healthInfo.error = `Connection failed: ${error}`;
    }

    return healthInfo;
}