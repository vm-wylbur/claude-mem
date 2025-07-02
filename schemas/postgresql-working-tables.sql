                                                         Table "public.memories"
    Column    |           Type           | Collation | Nullable |      Default      | Storage  | Compression | Stats target | Description 
--------------+--------------------------+-----------+----------+-------------------+----------+-------------+--------------+-------------
 memory_id    | text                     |           | not null |                   | extended |             |              | 
 project_id   | integer                  |           | not null |                   | plain    |             |              | 
 content      | text                     |           | not null |                   | extended |             |              | 
 content_type | character varying(50)    |           | not null |                   | extended |             |              | 
 metadata     | jsonb                    |           |          | '{}'::jsonb       | extended |             |              | 
 created_at   | timestamp with time zone |           |          | CURRENT_TIMESTAMP | plain    |             |              | 
 updated_at   | timestamp with time zone |           |          | CURRENT_TIMESTAMP | plain    |             |              | 
 embedding    | vector(768)              |           |          |                   | external |             |              | 
Indexes:
    "memories_pkey" PRIMARY KEY, btree (memory_id)
    "idx_memories_content_type" btree (content_type)
    "idx_memories_created_at" btree (created_at DESC)
    "idx_memories_embedding_cosine" hnsw (embedding vector_cosine_ops)
    "idx_memories_metadata" gin (metadata)
    "idx_memories_project_id" btree (project_id)
Check constraints:
    "memories_content_type_check" CHECK (content_type::text = ANY (ARRAY['conversation'::character varying, 'code'::character varying, 'decision'::character varying, 'reference'::character varying]::text[]))
Foreign-key constraints:
    "memories_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
Referenced by:
    TABLE "memory_relationships" CONSTRAINT "memory_relationships_source_memory_id_fkey" FOREIGN KEY (source_memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE
    TABLE "memory_relationships" CONSTRAINT "memory_relationships_target_memory_id_fkey" FOREIGN KEY (target_memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE
    TABLE "memory_tags" CONSTRAINT "memory_tags_memory_id_fkey" FOREIGN KEY (memory_id) REFERENCES memories(memory_id) ON DELETE CASCADE
Access method: heap

