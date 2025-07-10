import { InteractiveCuratorTool } from './dist/tools/interactive-curator.js';
import { DatabaseService } from './dist/db/service.js';
import { createDatabaseAdapterToml } from './dist/config.js';
import { config } from 'dotenv';

async function startCuration() {
  console.log('🎯 Starting Interactive Memory Curation Session');
  console.log('='.repeat(60));
  
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const curator = new InteractiveCuratorTool(dbService);
  
  // Start new curation session
  const result = await curator.handle({ 
    command: 'start', 
    limit: 50,
    includeCodeCheck: true, 
    codebaseRoot: '/home/pball/projects/claude-mem' 
  });
  
  const response = JSON.parse(result.content[0].text);
  
  console.log('✅ CURATION SESSION STARTED');
  console.log(`📋 Session ID: ${response.sessionId}`);
  console.log(`📊 Total Items Found: ${response.summary.totalItems}`);
  console.log(`📝 By Type:`, response.summary.byType);
  console.log(`🎯 Starting Mode: ${response.summary.startingMode}`);
  
  console.log('\n🎮 AVAILABLE COMMANDS:');
  response.commands.forEach(cmd => console.log(`   ${cmd}`));
  
  console.log('\n📁 Session saved to: .curation_session.json');
  console.log('\n⏭️  Ready for your first decision!');
  
  return response;
}

startCuration().catch(console.error);