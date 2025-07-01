#!/usr/bin/env python3
"""
Migrate SQLite memory database to PostgreSQL with pgvector
Converts BLOB embeddings to pgvector format
"""

import sqlite3
import psycopg
import struct
import json
import subprocess
import time
import signal
import os
from datetime import datetime

# Database connections
sqlite_db = '/Users/pball/.local/share/mcp-memory/memory.db'
ssh_hosts = ['snowl', 'snowball']  # snowl (LAN), snowball (Tailscale)
pg_db = 'claude_mem'
pg_user = 'postgres'
tunnel_port = 5433  # Use different port to avoid conflicts

def blob_to_vector(blob_data):
    """Convert SQLite BLOB (binary float64 array) to pgvector text format"""
    if not blob_data:
        return None
    
    # Unpack binary data as array of float64 (8 bytes each)
    float_count = len(blob_data) // 8
    vector = struct.unpack(f'{float_count}d', blob_data)
    
    # Convert to pgvector text format: [1.0,2.0,3.0,...]
    return '[' + ','.join(map(str, vector)) + ']'

def create_ssh_tunnel(ssh_host, local_port=5433, remote_port=5432):
    """Create SSH tunnel with robust error handling"""
    import subprocess
    import time
    
    # Check if local port is available
    result = subprocess.run(['lsof', '-Pi', f':{local_port}', '-sTCP:LISTEN', '-t'], 
                          capture_output=True, text=True)
    if result.stdout.strip():
        print(f"Local port {local_port} is already in use")
        # Try to cancel existing forwarding
        subprocess.run(['ssh', '-O', 'cancel', '-L', f'{local_port}:127.0.0.1:{remote_port}', ssh_host], 
                      capture_output=True)
        time.sleep(2)
    
    # Create SSH tunnel
    print(f"Creating SSH tunnel: {ssh_host} -> localhost:{local_port}")
    tunnel_cmd = [
        'ssh', '-o', 'ControlMaster=no', 
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-N', '-L', f'{local_port}:127.0.0.1:{remote_port}', 
        ssh_host
    ]
    
    # Start tunnel in background
    tunnel_process = subprocess.Popen(tunnel_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # Wait for tunnel to establish
    for i in range(10):
        time.sleep(1)
        result = subprocess.run(['lsof', '-Pi', f':{local_port}', '-sTCP:LISTEN', '-t'], 
                              capture_output=True, text=True)
        if result.stdout.strip():
            print(f"SSH tunnel established successfully! PID: {tunnel_process.pid}")
            return tunnel_process
        
    # Tunnel failed
    tunnel_process.terminate()
    raise Exception(f"Failed to establish SSH tunnel to {ssh_host}")

def cleanup_tunnel(tunnel_process, ssh_host, local_port=5433, remote_port=5432):
    """Clean up SSH tunnel gracefully"""
    if tunnel_process and tunnel_process.poll() is None:
        print("Cleaning up SSH tunnel...")
        # Try graceful cancellation first
        subprocess.run(['ssh', '-O', 'cancel', '-L', f'{local_port}:127.0.0.1:{remote_port}', ssh_host], 
                      capture_output=True)
        time.sleep(1)
        tunnel_process.terminate()
        tunnel_process.wait(timeout=5)
        print("SSH tunnel cleaned up")

def migrate_data():
    # Connect to SQLite
    sqlite_conn = sqlite3.connect(sqlite_db)
    sqlite_cur = sqlite_conn.cursor()
    
    # Connect to PostgreSQL via SSH tunnel with fallback strategy
    tunnel_process = None
    pg_conn = None
    
    for ssh_host in ssh_hosts:
        try:
            print(f"Trying SSH tunnel via {ssh_host}...")
            tunnel_process = create_ssh_tunnel(ssh_host, tunnel_port)
            
            # Connect via tunnel
            pg_conn = psycopg.connect(
                host='localhost',
                port=tunnel_port,
                dbname=pg_db,
                user=pg_user,
                connect_timeout=5
            )
            print(f"Connected successfully via {ssh_host}")
            break
            
        except Exception as e:
            print(f"Failed to connect via {ssh_host}: {e}")
            if tunnel_process:
                cleanup_tunnel(tunnel_process, ssh_host, tunnel_port)
                tunnel_process = None
    
    if not pg_conn:
        raise Exception("Could not connect to PostgreSQL via any SSH tunnel")
    pg_cur = pg_conn.cursor()
    
    # Get memories with embeddings
    sqlite_cur.execute("""
        SELECT 
            m.memory_id,
            m.project_id,
            m.content,
            m.content_type,
            m.metadata,
            m.created_at,
            e.vector
        FROM memories m
        JOIN embeddings e ON m.embedding_id = e.embedding_id
    """)
    
    memories_with_embeddings = sqlite_cur.fetchall()
    print(f"Found {len(memories_with_embeddings)} memories with embeddings")
    
    # Insert into PostgreSQL
    for row in memories_with_embeddings:
        memory_id, project_id, content, content_type, metadata, created_at, vector_blob = row
        
        # Convert BLOB to pgvector format
        vector_text = blob_to_vector(vector_blob)
        
        if vector_text:
            pg_cur.execute("""
                INSERT INTO memories (memory_id, project_id, content, content_type, metadata, created_at, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (memory_id, project_id, content, content_type, metadata, created_at, vector_text))
            print(f"Migrated memory {memory_id}")
    
    # Also migrate memories without embeddings (set embedding to NULL)
    sqlite_cur.execute("""
        SELECT 
            m.memory_id,
            m.project_id,
            m.content,
            m.content_type,
            m.metadata,
            m.created_at
        FROM memories m
        WHERE m.embedding_id IS NULL
    """)
    
    memories_without_embeddings = sqlite_cur.fetchall()
    print(f"Found {len(memories_without_embeddings)} memories without embeddings")
    
    for row in memories_without_embeddings:
        memory_id, project_id, content, content_type, metadata, created_at = row
        
        pg_cur.execute("""
            INSERT INTO memories (memory_id, project_id, content, content_type, metadata, created_at, embedding)
            VALUES (%s, %s, %s, %s, %s, %s, NULL)
        """, (memory_id, project_id, content, content_type, metadata, created_at))
        print(f"Migrated memory {memory_id} (no embedding)")
    
    # Commit
    pg_conn.commit()
    
    # Import memory_tags if file exists
    try:
        print("Importing memory_tags...")
        sqlite_cur.execute("SELECT * FROM memory_tags")
        memory_tags = sqlite_cur.fetchall()
        
        for memory_id, tag_id in memory_tags:
            pg_cur.execute("""
                INSERT INTO memory_tags (memory_id, tag_id)
                VALUES (%s, %s)
            """, (memory_id, tag_id))
        
        pg_conn.commit()
        print(f"Imported {len(memory_tags)} memory-tag relationships")
        
    except Exception as e:
        print(f"Error importing memory_tags: {e}")
    
    sqlite_conn.close()
    pg_conn.close()
    
    # Clean up tunnel
    if tunnel_process:
        cleanup_tunnel(tunnel_process, ssh_hosts[0] if ssh_hosts else 'snowl', tunnel_port)
    
    print("Migration completed!")

if __name__ == "__main__":
    migrate_data()