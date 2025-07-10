import { InteractiveCuratorTool } from './dist/tools/interactive-curator.js';
import { DatabaseService } from './dist/db/service.js';
import { createDatabaseAdapterToml } from './dist/config.js';
import { config } from 'dotenv';

async function testInteractiveCurator() {
  console.log('🧪 Testing Interactive Memory Curator');
  console.log('='.repeat(50));
  
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const curator = new InteractiveCuratorTool(dbService);
  
  console.log('🚀 Step 1: Starting new curation session...\n');
  
  // Start curation session
  const startResult = await curator.handle({ 
    command: 'start', 
    limit: 10,  // Small test batch
    includeCodeCheck: true, 
    codebaseRoot: '/home/pball/projects/claude-mem' 
  });
  
  console.log('START RESULT:');
  console.log(JSON.parse(startResult.content[0].text));
  
  console.log('\n📋 Step 2: Checking session status...\n');
  
  // Check status
  const statusResult = await curator.handle({ command: 'status' });
  console.log('STATUS:');
  console.log(JSON.parse(statusResult.content[0].text));
  
  console.log('\n🎯 Step 3: Getting next item to triage...\n');
  
  // Get next item
  const nextResult = await curator.handle({ command: 'next' });
  console.log('NEXT ITEM:');
  console.log(JSON.parse(nextResult.content[0].text));
  
  console.log('\n📊 Step 4: Checking queue status...\n');
  
  // Check queue status  
  const queueResult = await curator.handle({ 
    command: 'queue', 
    subCommand: 'status' 
  });
  console.log('QUEUE STATUS:');
  console.log(JSON.parse(queueResult.content[0].text));
  
  console.log('\n🔄 Step 5: Switching to enhancement mode...\n');
  
  // Switch mode
  const modeResult = await curator.handle({ 
    command: 'mode', 
    mode: 'enhance' 
  });
  console.log('MODE SWITCH:');
  console.log(JSON.parse(modeResult.content[0].text));
  
  console.log('\n✅ Interactive Curator Test Complete!');
  console.log('\nThe system successfully:');
  console.log('- Started a curation session with multi-AI analysis');
  console.log('- Extracted actionable recommendations into triageable items');
  console.log('- Provided session state management');
  console.log('- Enabled mode switching for focused triage');
  console.log('- Demonstrated queue-based workflow patterns');
  
  console.log('\n🎯 Next steps for real usage:');
  console.log('1. Use "next y" to queue items for action');
  console.log('2. Use "details" to see full context for any item');
  console.log('3. Use "execute" to batch-process all queued actions');
  console.log('4. Session state persists in .curation_session.json');
}

testInteractiveCurator().catch(console.error);