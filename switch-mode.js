import { InteractiveCuratorTool } from './dist/tools/interactive-curator.js';
import { DatabaseService } from './dist/db/service.js';
import { createDatabaseAdapterToml } from './dist/config.js';
import { config } from 'dotenv';

async function switchToEnhanceMode() {
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const curator = new InteractiveCuratorTool(dbService);
  
  console.log('🔄 Switching to ENHANCEMENT mode...\n');
  
  const result = await curator.handle({ 
    command: 'mode', 
    mode: 'enhance' 
  });
  
  const response = JSON.parse(result.content[0].text);
  
  console.log('✅', response.message);
  console.log('📊 Mode Stats:', response.modeStats);
  
  if (response.currentItem) {
    console.log('\n🎯 FIRST ENHANCEMENT OPPORTUNITY:');
    console.log('='.repeat(50));
    console.log(`Item ID: ${response.currentItem.itemId}`);
    console.log(`Memory: ${response.currentItem.memoryId}`);
    console.log(`Confidence: ${response.currentItem.confidence}%`);
    console.log(`\n📝 Enhancement Recommendation:`);
    console.log(`${response.currentItem.recommendation}`);
    console.log(`\n${response.prompt}`);
    
    console.log('\n🎮 YOUR OPTIONS:');
    console.log('   y = Queue this enhancement');
    console.log('   n = Reject this recommendation');  
    console.log('   s = Skip for now');
    console.log('   d = Show detailed context');
    
    console.log('\n💡 TIP: Type "d" first to see the memory content and agent findings!');
  }
}

switchToEnhanceMode().catch(console.error);