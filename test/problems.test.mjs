import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnostic} from '../server/problems.mjs';

test('diagnostics identify the failing service without retaining error details',()=>{
  for(const [error,stage,code] of [
    [{status:0},'host','host-unavailable'],[{status:401},'host','host-refused'],[{status:403},'host','host-refused'],
    [{code:'host-version'},'host','host-incompatible'],[{status:401},'provider','token-rejected'],
    [{status:409,code:'webhook-conflict'},'provider','webhook-conflict'],[{status:409},'provider','poller-conflict'],
    [{status:403},'provider','chat-blocked'],[{status:0},'provider','provider-unavailable'],
  ]){
    const result=diagnostic({...error,message:'PRIVATE_CANARY https://invalid.example/botPRIVATE'},stage);
    assert.equal(result.code,code);
    assert(!JSON.stringify(result).includes('PRIVATE'));
    assert(!JSON.stringify(result).includes('https:'));
  }
});
