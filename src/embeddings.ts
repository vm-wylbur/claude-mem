import fetch from 'node-fetch';

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
 * Generate embeddings with fallback for resilience
 * Returns null if embedding generation fails, allowing storage without vectors
 */
export async function generateEmbeddingWithFallback(text: string): Promise<number[] | null> {
    try {
        return await generateEmbedding(text);
    } catch (error) {
        console.warn('Embedding generation failed, storing without vector:', error);
        return null;
    }
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