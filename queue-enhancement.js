import { InteractiveCuratorTool } from './dist/tools/interactive-curator.js';
import { DatabaseService } from './dist/db/service.js';
import { createDatabaseAdapterToml } from './dist/config.js';
import { config } from 'dotenv';

async function queueEnhancement() {
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const curator = new InteractiveCuratorTool(dbService);
  
  console.log('✅ Queuing enhancement with action "y"...\n');
  
  const result = await curator.handle({ 
    command: 'next',
    action: 'y'
  });
  
  const response = JSON.parse(result.content[0].text);
  
  if (response.currentItem) {
    console.log('🎯 ENHANCEMENT QUEUED! Moving to next item...');
    console.log('='.repeat(50));
    console.log(`Next Item: ${response.currentItem.itemId}`);
    console.log(`Type: ${response.currentItem.type.toUpperCase()}`);
    console.log(`Memory: ${response.currentItem.memoryId}`);
    console.log(`Confidence: ${response.currentItem.confidence}%`);
    console.log(`\n📝 Recommendation:`);
    console.log(`${response.currentItem.recommendation}`);
    console.log(`\n${response.prompt}`);
    console.log(`\n📊 Progress: ${response.progress.current}/${response.progress.total}`);
  } else {
    console.log('📋 MODE COMPLETE:', response.message);
    if (response.suggestions) {
      console.log('\n💡 SUGGESTIONS:');
      response.suggestions.forEach(s => console.log(`   • ${s}`));
    }
  }
  
  // Show queue status
  console.log('\n📊 CHECKING QUEUE STATUS...');
  const queueResult = await curator.handle({ 
    command: 'queue', 
    subCommand: 'status' 
  });
  const queueStatus = JSON.parse(queueResult.content[0].text);
  
  console.log(`✅ Enhancements Queued: ${queueStatus.queues.enhancements.count}`);
  console.log(`📋 Total Items Queued: ${Object.values(queueStatus.queues).reduce((sum, q) => sum + (q.count || 0), 0)}`);
}

queueEnhancement().catch(console.error);