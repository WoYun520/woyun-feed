// Fixed public author endpoints; visitor preferences only affect browser display.
// Verified 2026-10-03. These pages expose 7-day top ten, not complete timelines.
export const CREATOR_SOURCES = [
  {handle:'vikingmute',name:'Viking'},
  {handle:'vista8',name:'向阳乔木'},
  {handle:'abskoop',name:'@abskoop'},
  {handle:'imwsl90',name:'@imwsl90'},
].map(({handle,name})=>({
  id:'sopilot-author-'+handle.toLowerCase(),channel:'sopilot-author-'+handle.toLowerCase(),
  name:'教程博主 · '+name,group:'posts',kind:'aggregator',format:'sopilot-author',
  creator_handle:handle,home_url:'https://x.com/'+handle,
  feed_url:'https://sopilot.net/zh/rank/creators/'+handle,
  ranked:false,link_kind:'post',
  reading_note:'指定作者近7日按曝光排序的前10条摘录；非完整动态，未读取原帖全文或图片步骤，未核对热度、未实测。',
}));

// Author-owned subscriptions discovered through their actual homepage links.
// These are recent blog articles, not X timelines or popularity rankings.
const existingBlogSources = [
  {handle:'vikingmute',name:'Viking',origin:'https://vikingz.me',feed:'https://vikingz.me/rss.xml'},
  {handle:'vista8',name:'向阳乔木',origin:'https://blog.qiaomu.ai',feed:'https://blog.qiaomu.ai/feed.xml'},
].map(({handle,name,origin,feed})=>({
  id:'creator-blog-'+handle,channel:'creator-blog-'+handle,
  name:'作者博客 · '+name,group:'creators',kind:'original',format:'rss',
  creator_scope:'blog-feed',creator_handle:handle,creator_name:name,
  creator_id:'creator-'+handle,source_id:'creator-blog-'+handle,
  allowed_article_origin:origin,home_url:origin+'/',feed_url:feed,
  allowed_channel_urls:[origin+'/'],
  ranked:false,link_kind:'article',
  reading_note:'作者自有博客订阅，最近最多30篇；保留标题、订阅摘要和原文时间。教程按操作线索初筛，不按热度；未核对原文全文或实测。',
}));

// Author-owned Chinese subscriptions verified through each author's public
// homepage. These IDs identify a configured subscription, never an X account.
export const NEW_CREATOR_BLOG_SOURCES = [
  {slug:'esorhuang',name:'Esor Huang · 電腦玩物',origin:'https://www.playpcesor.com',
    feed:'https://feeds.feedburner.com/playpc',format:'atom',upgrade_article_http:true},
  {slug:'raymondhouch',name:'雷蒙 · 侯智薰',origin:'https://raymondhouch.com',
    feed:'https://raymondhouch.com/feed/',format:'rss'},
  {slug:'fqzlr',name:'番茄主理人 · Fqzlr',origin:'https://blog.fqzlr.top',
    feed:'https://blog.fqzlr.top/rss.xml',format:'rss',exclude_nonpublic_samples:true},
].map(({slug,name,origin,feed,format,...options})=>({
  id:'creator-blog-'+slug,source_id:'creator-blog-'+slug,channel:'creator-blog-'+slug,
  creator_id:'creator-'+slug,creator_name:name,creator_scope:'blog-feed',
  name:'作者博客 · '+name,group:'creators',kind:'original',format,
  home_url:origin+'/',allowed_article_origin:origin,allowed_channel_urls:[origin+'/'],
  feed_url:feed,read_summary:true,ranked:false,link_kind:'article',...options,
  reading_note:'作者公开博客订阅，按原文发布时间取最近最多30篇；保留最多1000字摘录与原文时间。按操作线索初筛，未核对原文全文或实测。',
}));

export const CREATOR_BLOG_SOURCES = [...existingBlogSources,...NEW_CREATOR_BLOG_SOURCES];
