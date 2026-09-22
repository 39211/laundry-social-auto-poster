import {resolve} from 'node:path';
import {rebuildStoreReview} from '../src/seo90/storeReview';
const [workspace,storeId,policySha256,run]=process.argv.slice(2);
if(!workspace||!storeId||!policySha256||!run)throw Error('Usage: tsx scripts/seo90-store-review.ts WORKSPACE EXPECTED_STORE TRUSTED_POLICY_SHA NEW_RUN_ID');
rebuildStoreReview(resolve(workspace),{storeId,policySha256},run,new Date().toISOString())
  .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
