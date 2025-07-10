import { InteractiveCuratorTool } from './dist/tools/interactive-curator.js';
import { DatabaseService } from './dist/db/service.js';
import { createDatabaseAdapterToml } from './dist/config.js';
import { config } from 'dotenv';

async function showDetails() {
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const curator = new InteractiveCuratorTool(dbService);
  
  console.log('🔍 DETAILED ANALYSIS');
  console.log('='.repeat(60));
  
  const result = await curator.handle({ command: 'details' });
  const response = JSON.parse(result.content[0].text);
  
  console.log(`📋 ${response.title}`);
  console.log(`\n🎯 Recommendation: ${response.recommendation}`);
  console.log(`📊 AI Confidence: ${response.confidence}`);
  
  if (response.agentFindings && response.agentFindings.length > 0) {
    console.log(`\n🤖 AGENT FINDINGS:`);
    response.agentFindings.forEach((finding, i) => {
      console.log(`   ${i + 1}. ${finding}`);
    });
  }
  
  if (response.memory) {
    console.log(`\n📄 MEMORY CONTENT:`);
    console.log(`ID: ${response.memory.id}`);
    console.log(`Type: ${response.memory.type}`);
    console.log(`Created: ${response.memory.created}`);
    console.log(`\nContent Preview:`);
    console.log(`"${response.memory.preview}"`);
  }
  
  if (response.metadata) {
    console.log(`\n📊 METADATA:`, response.metadata);
  }
  
  console.log(`\n${response.prompt}`);
  
  console.log(`\n🎮 NEXT STEPS:`);
  console.log(`   y = Queue this enhancement for action`);
  console.log(`   n = Reject this recommendation`);
  console.log(`   s = Skip for now and move to next item`);
}

showDetails().catch(console.error);