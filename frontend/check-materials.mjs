import {PRACTICAL_ITEMS} from './src/practicalMaterials.js';
import {materialReview} from './src/materialReview.js';
const now=new Date().toISOString();
console.log(JSON.stringify({checked_at:now,scope:'维护提醒，不重新抓取官网或实测',materials:PRACTICAL_ITEMS.map(item=>({title:item.title,url:item.original_url,...materialReview(item,now)}))},null,2));
