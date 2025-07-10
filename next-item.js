import { InteractiveCuratorTool } from './dist/tools/interactive-curator.js';
import { DatabaseService } from './dist/db/service.js';
import { createDatabaseAdapterToml } from './dist/config.js';
import { config } from 'dotenv';

async function getNextItem() {
  config();
  const adapter = await createDatabaseAdapterToml();
  const dbService = new DatabaseService(adapter);
  await dbService.initialize();
  
  const curator = new InteractiveCuratorTool(dbService);
  
  const result = await curator.handle({ command: 'next' });
  const response = JSON.parse(result.content[0].text);
  
  if (response.currentItem) {
    console.log('🎯 FIRST ITEM TO TRIAGE:');
    console.log('='.repeat(40));
    console.log(`Type: ${response.currentItem.type.toUpperCase()}`);
    console.log(`Confidence: ${response.currentItem.confidence}%`);
    console.log(`Memory: ${response.currentItem.memoryId}`);
    console.log(`\n📝 Recommendation:`);
    console.log(`${response.currentItem.recommendation}`);
    console.log(`\n${response.prompt}`);
    console.log(`\n📊 Progress: ${response.progress.current}/${response.progress.total} in ${response.progress.mode} mode`);
  } else {
    console.log('📋 STATUS:', response.message);
    if (response.suggestions) {
      console.log('\n💡 SUGGESTIONS:');
      response.suggestions.forEach(s => console.log(`   • ${s}`));
    }
  }
}

getNextItem().catch(console.error);