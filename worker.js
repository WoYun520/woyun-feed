import { PUBLIC_FEED_KEY, runScheduledUpdate } from './frontend/cloud-feed-service.js';
import { handleDotInboxRequest, isDotInboxRoute } from './dot-inbox-service.js';
import { handleHomeBoostRequest, isHomeBoostRoute } from './frontend/home-boost-service.js';

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(isDotInboxRoute(url.pathname)) return handleDotInboxRequest(request,env);
    if(isHomeBoostRoute(url.pathname)) return handleHomeBoostRequest(request,env);
    if(url.pathname==='/data/public-feed.json') {
      if(!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
      try {
        const raw=await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY);
        if(raw) return new Response(request.method==='HEAD' ? null : raw,{headers:{
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
          'X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin'
        }});
      } catch { /* Static public data stays readable if cloud storage is temporarily unavailable. */ }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller,env) {
    await runScheduledUpdate(env);
  }
};
