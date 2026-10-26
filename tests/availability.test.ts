import {expect,test} from 'bun:test';
import {availabilityResponse,parseAvailabilityState,renderAvailabilityPage,transitionAvailability,type AvailabilityState} from '../src';
const state:AvailabilityState={mode:'maintenance',revision:1,changedAt:'2026-10-26T00:00:00Z',changedBy:'private-actor',reason:'private-contract-details',expectedBackAt:'2026-10-26T01:00:00Z'};
const config={serviceName:'onSpark',contactUrl:'https://example.com/support'};
test('HTML and JSON preserve 503, avoid caching and never expose operational details',async()=>{
 for(const accept of ['text/html','application/json']){
  const response=availabilityResponse(new Request('https://example.com',{headers:{accept}}),state,config,Date.parse(state.changedAt))!;
  expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('retry-after')).toBe('3600');
  const body=await response.text();expect(body).not.toContain(state.reason);expect(body).not.toContain(state.changedBy);expect(body).toContain('onSpark');
 }
});
test('an expired estimate never silently opens traffic',()=>{
 expect(availabilityResponse(new Request('https://example.com'),state,config,Date.parse('2027-01-01'))?.status).toBe(503);
});
test('hold remains explicit, has no retry promise, and HEAD has no body',async()=>{
 const hold=parseAvailabilityState({...state,mode:'developer_hold',expectedBackAt:undefined});
 const response=availabilityResponse(new Request('https://example.com',{method:'HEAD'}),hold,config)!;
 expect(response.status).toBe(503);expect(response.headers.has('retry-after')).toBe(false);expect(await response.text()).toBe('');
 expect(renderAvailabilityPage(hold,config)).toContain('Please contact the developer');
});
test('no implicit bypass on admin, health, query, or headers',()=>{
 for(const path of ['/admin','/healthz','/?maintenance=false']) expect(availabilityResponse(new Request('https://example.com'+path,{headers:{'x-maintenance-bypass':'true'}}),state,config)?.status).toBe(503);
 expect(availabilityResponse(new Request('https://example.com'),{...state,mode:'open',expectedBackAt:undefined} as unknown as AvailabilityState,config)).toBeUndefined();
});
test('reject invalid state and unsafe contact links; escape public markup',()=>{
 for(const input of [null,{}, {...state,mode:'wrong'}, {...state,revision:-1},{...state,mode:'developer_hold'}])expect(()=>parseAvailabilityState(input)).toThrow();
 for(const contactUrl of ['javascript:alert(1)','http://example.com','https://user:pass@example.com','mailto:a@example.com\r\nBcc:x'])expect(()=>renderAvailabilityPage(state,{...config,contactUrl})).toThrow();
 const html=renderAvailabilityPage(state,{serviceName:'<script>alert(1)</script>',contactUrl:'https://example.com',contactLabel:'<img src=x>'});
 expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).toContain('&lt;script&gt;');
});
test('authorization, audit and stale revision failures cannot return changed state',async()=>{
 let audited=0;const change={mode:'developer_hold' as const,actor:'operator',reason:'approved hold'};
 const common={current:state,change,expectedRevision:1,audit:()=>{audited++}};
 await expect(transitionAvailability({...common,authorize:()=>false})).rejects.toThrow('not authorized');expect(audited).toBe(0);
 await expect(transitionAvailability({...common,expectedRevision:0,authorize:()=>true})).rejects.toThrow('conflict');
 await expect(transitionAvailability({...common,authorize:()=>true,audit:()=>{throw Error('audit unavailable')}})).rejects.toThrow('audit unavailable');
 const changed=await transitionAvailability({...common,authorize:()=>true});expect(changed.mode).toBe('developer_hold');expect(changed.revision).toBe(2);expect(changed.expectedBackAt).toBeUndefined();expect(state.mode).toBe('maintenance');expect(audited).toBe(1);
});
