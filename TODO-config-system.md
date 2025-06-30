# TODO: Proper Configuration System

## Current Problems
- Database path hardcoded as fallback in agent-cli.js 
- Configuration scattered between .env files, environment variables, and hardcoded paths
- No centralized config management
- Poor XDG compliance (database was in repo until manually moved)
- MCP server configuration requires environment variables in command line

## Desired Configuration Architecture

### 1. Configuration File Hierarchy
```
~/.config/mcp-memory/
├── config.yaml           # Main configuration
├── profiles/              # Environment-specific configs
│   ├── development.yaml
│   ├── production.yaml
│   └── testing.yaml
└── secrets.yaml          # API keys, sensitive data (gitignored)
```

### 2. Default Configuration (config.yaml)
```yaml
database:
  path: ~/.local/share/mcp-memory/memory.db
  backup_path: ~/.local/share/mcp-memory/backups/
  max_backup_files: 10

ollama:
  host: http://localhost:11434
  model: nomic-embed-text
  timeout: 30000

server:
  port: null  # null for MCP stdio mode
  log_level: info
  log_path: ~/.local/share/mcp-memory/logs/

memory:
  max_memories: 10000
  auto_cleanup: true
  default_project: "default"
```

### 3. CLI Configuration Override
```bash
# Use specific config
memory-server --config ~/.config/mcp-memory/profiles/testing.yaml

# Override specific settings
memory-server --database-path /tmp/test.db --ollama-host http://remote:11434

# Agent CLI should use same config system
agent-cli --profile development search "query"
```

### 4. Environment Variable Support
```bash
# Environment variables override config files
MCP_MEMORY_DATABASE_PATH=/custom/path/memory.db
MCP_MEMORY_OLLAMA_HOST=http://remote:11434
```

## Implementation Plan

### Phase 1: Configuration Library
- [ ] Add configuration management dependencies (js-yaml, commander enhancements)
- [ ] Create ConfigManager class that handles:
  - [ ] Config file discovery (XDG_CONFIG_HOME, ~/.config)
  - [ ] Profile selection
  - [ ] Environment variable overrides
  - [ ] Validation and defaults
- [ ] Create default config.yaml template

### Phase 2: Refactor Existing Code
- [ ] Update main server (dist/index.js) to use ConfigManager
- [ ] Update agent-cli.js to use ConfigManager
- [ ] Remove hardcoded paths and env var fallbacks
- [ ] Add --config and --profile CLI options

### Phase 3: Enhanced Features
- [ ] Config validation with schemas
- [ ] Config migration for version updates
- [ ] Setup wizard for first-time users
- [ ] Profile management commands (create, list, switch)

### Phase 4: XDG Compliance
- [ ] Automatic directory creation with proper permissions
- [ ] Respect XDG_CONFIG_HOME and XDG_DATA_HOME
- [ ] Migration tool for existing installations
- [ ] Documentation updates

## Implementation Details

### ConfigManager Interface
```javascript
class ConfigManager {
  constructor(options = {}) {
    this.configPath = options.configPath || this.findConfigPath();
    this.profile = options.profile || 'default';
  }
  
  async load() {
    // Load config hierarchy: defaults -> config file -> profile -> env vars
  }
  
  get(key) {
    // Get config value with dot notation: 'database.path'
  }
  
  validate() {
    // Validate configuration against schema
  }
}
```

### CLI Integration
```javascript
// In both server and agent-cli
const config = new ConfigManager({
  configPath: program.opts().config,
  profile: program.opts().profile
});
await config.load();

const dbPath = config.get('database.path');
const ollamaHost = config.get('ollama.host');
```

## Benefits
- **User-friendly**: Clear configuration location and structure
- **Flexible**: Multiple ways to override settings (files, profiles, env vars, CLI)
- **Maintainable**: Centralized configuration logic
- **Portable**: Easy to backup/restore configurations
- **Standards-compliant**: Follows XDG Base Directory Specification
- **Development-friendly**: Easy to switch between dev/test/prod settings

## Migration Strategy
1. Create default config on first run if none exists
2. Auto-migrate database to proper location if needed
3. Preserve existing environment variable behavior during transition
4. Provide migration tool for existing users

## Testing Requirements
- [ ] Unit tests for ConfigManager
- [ ] Integration tests with different config scenarios
- [ ] Test profile switching and overrides
- [ ] Test XDG compliance on different platforms