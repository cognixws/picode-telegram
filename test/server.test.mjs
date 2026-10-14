import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/server.mjs';
import { jsonRequest, ApiError } from '../server/http.mjs';

test('protected setup refuses missing authority and never reflects submitted secrets', async t => {
 const server=createServer({status:()=>({state:'needs-token'})},{secret:'fixture-authority',verify:async()=>{throw new ApiError(401,'must not expose provider detail or input');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 await assert.rejects(jsonRequest(new URL('/status',base)),error=>error.status===401);
 const status=await jsonRequest(new URL('/status',base),{headers:{'X-PiCode-Proxy-Secret':'fixture-authority'}});
 assert.equal(status.state,'needs-token');
 const result=await jsonRequest(new URL('/settings/check',base),{method:'POST',body:{secrets:{bot_token:'private synthetic input'}},headers:{'X-PiCode-Proxy-Secret':'fixture-authority'},acceptErrorBody:true});
 assert.deepEqual(result,{message:'The bot token is invalid. Check it in BotFather.'});
});
