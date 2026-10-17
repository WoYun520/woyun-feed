import { PUBLIC_FEED_KEY, runScheduledUpdate } from './frontend/cloud-feed-service.js';
import { ESSENCE_SWEEP_CRON } from './frontend/essence-schedule.js';
import { runEssenceSweep } from './frontend/essence-sweep.js';
import { handleDotInboxRequest, isDotInboxRoute } from './dot-inbox-service.js';
import { handleDotPendingRequest, isDotPendingRoute } from './dot-pending-service.js';
import { handleDotUnderratedRequest, isDotUnderratedRoute, overlayPublicUnderratedPins } from './dot-underrated-service.js';
import { handleHomeBoostRequest, isHomeBoostRoute } from './frontend/home-boost-service.js';
import { handleVisitorFeedbackRequest, isVisitorFeedbackRoute } from './visitor-feedback-service.js';
import { handleEssenceArchiveRequest, isEssenceArchiveRoute } from './frontend/essence-archive-service.js';

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(isDotUnderratedRoute(url.pathname)) return handleDotUnderratedRequest(request,env);
    if(isDotPendingRoute(url.pathname)) return handleDotPendingRequest(request,env);
    if(isDotInboxRoute(url.pathname)) return handleDotInboxRequest(request,env);
    if(isHomeBoostRoute(url.pathname)) return handleHomeBoostRequest(request,env);
    if(isVisitorFeedbackRoute(url.pathname)) return handleVisitorFeedbackRequest(request,env);
    if(isEssenceArchiveRoute(url.pathname)) return handleEssenceArchiveRequest(request,env);
    if(url.pathname==='/data/public-feed.json') {
      if(!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
      try {
        const raw=await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY);
        if(raw) {
          const body=request.method==='HEAD' ? null : await overlayPublicUnderratedPins(raw,env);
          return new Response(body,{headers:{
            'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
            'X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin'
          }});
        }
      } catch { /* Static public data stays readable if cloud storage is temporarily unavailable. */ }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller,env) {
    if(controller?.cron===ESSENCE_SWEEP_CRON) {
      await runEssenceSweep(env);
      return;
    }
    await runScheduledUpdate(env);
  }
};
