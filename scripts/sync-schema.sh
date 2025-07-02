#!/bin/bash
# Schema Synchronization Script
# Author: PB and Claude
# Date: 2025-07-02
# License: (c) HRDAG, 2025, GPL-2 or newer
#
# Automatically extract and update schema files from live PostgreSQL
# Usage: ./scripts/sync-schema.sh [--commit]

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="$PROJECT_ROOT/postgresql-working-schema.sql"
TEMP_SCHEMA="/tmp/postgresql-schema-$$.sql"

echo "🔄 Syncing PostgreSQL schema from live database..."

# Extract schema from live PostgreSQL via SSH
echo "📡 Connecting to PostgreSQL via SSH tunnel..."
if ssh snowl "pg_dump -h localhost -p 5432 -U pball -d claude_mem --schema-only" > "$TEMP_SCHEMA" 2>/dev/null; then
    echo "✅ Connected via pball user (primary)"
elif ssh snowl "pg_dump -h localhost -p 5432 -U postgres -d claude_mem --schema-only" > "$TEMP_SCHEMA" 2>/dev/null; then
    echo "✅ Connected via postgres user (fallback)"
elif ssh snowball "pg_dump -h localhost -p 5432 -U pball -d claude_mem --schema-only" > "$TEMP_SCHEMA" 2>/dev/null; then
    echo "✅ Connected via snowball+pball (fallback)"
else
    echo "❌ Failed to connect to PostgreSQL"
    echo "💡 Make sure:"
    echo "   - SSH connections to snowl/snowball are working"
    echo "   - PostgreSQL is running on the remote host"
    echo "   - Database 'claude_mem' exists"
    echo "   - User has access permissions"
    rm -f "$TEMP_SCHEMA"
    exit 1
fi

# Validate the extracted schema
if [ ! -s "$TEMP_SCHEMA" ]; then
    echo "❌ Extracted schema is empty"
    rm -f "$TEMP_SCHEMA"
    exit 1
fi

# Check if schema contains expected tables
if ! grep -q "CREATE TABLE.*memories" "$TEMP_SCHEMA"; then
    echo "❌ Schema doesn't contain expected tables (memories table missing)"
    echo "📄 Schema preview:"
    head -20 "$TEMP_SCHEMA"
    rm -f "$TEMP_SCHEMA"
    exit 1
fi

# Compare with existing schema
if [ -f "$SCHEMA_FILE" ]; then
    if diff -q "$SCHEMA_FILE" "$TEMP_SCHEMA" >/dev/null 2>&1; then
        echo "✅ Schema is already up to date"
        rm -f "$TEMP_SCHEMA"
        exit 0
    else
        echo "📋 Schema changes detected:"
        echo "--- Current schema"
        echo "+++ Live database schema"
        diff -u "$SCHEMA_FILE" "$TEMP_SCHEMA" || true
        echo ""
    fi
fi

# Update the schema file
echo "📝 Updating $SCHEMA_FILE..."
mv "$TEMP_SCHEMA" "$SCHEMA_FILE"

# Add header comment with timestamp
TEMP_WITH_HEADER="/tmp/schema-with-header-$$.sql"
cat > "$TEMP_WITH_HEADER" << EOF
-- PostgreSQL Schema (auto-synced $(date -u +"%Y-%m-%d %H:%M:%S UTC"))
-- This schema was automatically extracted from the live database
-- DO NOT EDIT MANUALLY - Use ./scripts/sync-schema.sh to update

EOF
cat "$SCHEMA_FILE" >> "$TEMP_WITH_HEADER"
mv "$TEMP_WITH_HEADER" "$SCHEMA_FILE"

echo "✅ Schema file updated successfully"

# Handle git operations if requested
if [ "$1" = "--commit" ]; then
    cd "$PROJECT_ROOT"
    
    if git diff --quiet postgresql-working-schema.sql; then
        echo "📋 No changes to commit"
    else
        echo "📝 Staging schema changes..."
        git add postgresql-working-schema.sql
        
        echo "💾 Committing schema update..."
        git commit -m "Auto-sync PostgreSQL schema from live database

Schema updated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

By PB & Claude"
        
        echo "✅ Schema changes committed successfully"
    fi
fi

echo ""
echo "🎉 Schema sync completed!"
echo "📁 Updated: $SCHEMA_FILE"
echo ""
echo "💡 Usage:"
echo "   ./scripts/sync-schema.sh         # Update schema file only"
echo "   ./scripts/sync-schema.sh --commit # Update and commit to git"