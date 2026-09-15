import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// This is an execution test of production functions, not a browser certification.
const app = readFileSync(new URL('../wireframes/app.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../wireframes/auth.js', import.meta.url), 'utf8');
const start = app.indexOf('function validKpiRecovery(');
const end = app.indexOf('function redirectForKpiReauthentication', start);
const now = Date.now();
const context = vm.createContext({
  kpiRecoveryVersion: 2, kpiRecoveryTtlMs: 1800000,
  liveUserId: 'user-a', liveWorkspaceId: 'space-a', Date,
});
vm.runInContext(app.slice(start, end), context);
context.envelope = {version:2,userId:'user-a',workspaceId:'space-a',createdAt:now,expiresAt:now+600000,nonce:'a'.repeat(36),step:3,focusId:'builderNext',
  draft:{source:'google',name:'Revenue',displayType:'scorecard',displayFormat:'currency'}};
const run = code => vm.runInContext(code,context);
assert.equal(run('validKpiRecovery(envelope,envelope.nonce)'),true);
for (const expression of [
  '{...envelope,userId:"user-b"}',
  '{...envelope,workspaceId:"space-b"}',
  '{...envelope,version:1}',
  '{...envelope,createdAt:Date.now()+100000}',
  '{...envelope,expiresAt:Date.now()-1}',
  '{...envelope,unexpected:"value"}',
  '{...envelope,draft:{...envelope.draft,connectionId:"private"}}',
  '{...envelope,draft:{...envelope.draft,name:{bad:true}}}',
]) assert.equal(run('validKpiRecovery('+expression+',envelope.nonce)'),false,expression);
assert.equal(run('validKpiRecovery(envelope,"b".repeat(36))'),false);

// Execute the actual login callback with a successful same-origin response.
const callbackStart = auth.indexOf("loginForm?.addEventListener('submit', ");
const callbackEnd = auth.indexOf("document.querySelector('[data-forgot]')",callbackStart);
let callback, assigned;
const loginContext=vm.createContext({
  loginForm:{addEventListener(_event,handler){callback=handler;}},
  validFields:()=>true,setLoading(){},showAlert(){},
  FormData:class { entries(){return [][Symbol.iterator]();} },
  fetch:async()=>({ok:true,json:async()=>({redirect:'/app'})}),
  location:{assign(value){assigned=value;}},
  authReturnTarget:'/app?recover='+'a'.repeat(36),
});
vm.runInContext(auth.slice(callbackStart,callbackEnd),loginContext);
await callback({preventDefault(){}});
assert.equal(assigned,'/app?recover='+'a'.repeat(36));
loginContext.fetch=async()=>({ok:true,json:async()=>({redirect:'/pricing?access=subscription_required'})});
await callback({preventDefault(){}});
assert.equal(assigned,'/pricing?access=subscription_required','paid gate wins over return target');
console.log('Session recovery production-function tests passed: identity, expiry, payload bounds, login return and paid gate.');
