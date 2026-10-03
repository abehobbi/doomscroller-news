import crypto from 'node:crypto';

const STOP=new Set('a an and are as at be been by for from has have how in into is it its new of on or over says said that the their this to under was were will with after amid about during more than'.split(' '));
const PLACES=[
  ['Syria',/\b(syria|syrian|damascus|aleppo|idlib|daraa|homs|hama|latakia|hasakah|raqqa|deir ez[- ]zor|qamishli)\b/i,'Syria'],
  ['Bangladesh',/\b(bangladesh|bangladeshi|dhaka|chattogram|chittagong|sylhet|khulna|rajshahi|rohingya)\b/i,'Bangladesh'],
  ['Ghana',/\b(ghana|ghanaian|accra|kumasi|tamale|takoradi)\b/i,'Ghana'],
  ['GTA',/\b(toronto|scarborough|etobicoke|north york|mississauga|brampton|peel region|york region|durham region|halton region)\b/i,'Canada'],
  ['Canada',/\b(canada|canadian|ottawa|ontario|quebec|alberta|british columbia|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland)\b/i,'Canada'],
  ['Palestinian territories',/\b(gaza|west bank|palestin(?:e|ian))\b/i,'Middle East'],
  ['Israel',/\b(israel|israeli|tel aviv|jerusalem)\b/i,'Middle East'],
  ['Lebanon',/\b(lebanon|lebanese|beirut)\b/i,'Middle East'],
  ['Iran',/\b(iran|iranian|tehran)\b/i,'Middle East'],
  ['Persian Gulf',/\b(strait of hormuz|hormuz|persian gulf|gulf of oman)\b/i,'Middle East'],
  ['Iraq',/\b(iraq|iraqi|baghdad|erbil|kurdistan)\b/i,'Middle East'],
  ['Yemen',/\b(yemen|yemeni|sanaa|houthi)\b/i,'Middle East'],
  ['Saudi Arabia',/\b(saudi arabia|saudi|riyadh)\b/i,'Middle East'],
  ['Qatar',/\b(qatar|qatari|doha)\b/i,'Middle East'],
  ['Jordan',/\b(jordan|jordanian|amman)\b/i,'Middle East'],
  ['United Arab Emirates',/\b(united arab emirates|uae|emirati|dubai|abu dhabi)\b/i,'Middle East'],
  ['Ethiopia',/\b(ethiopia|ethiopian|tigray|tigrayan|amhara|addis ababa)\b/i,'Africa'],
  ['United Kingdom',/\b(united kingdom|britain|british|england|scotland|wales|london)\b/i,'Europe'],
  ['United States',/\b(united states|u\.s\.|american|washington|new york)\b/i,'North America'],
  ['Ukraine',/\b(ukraine|ukrainian|kyiv)\b/i,'Europe'],
  ['Russia',/\b(russia|russian|moscow)\b/i,'Europe'],
];
const ACTIONS=/\b(attack|strike|kill|ceasefire|offensive|invad|elect|appoint|resign|approve|ban|launch|arrest|charg|convict|sentence|bail|appeal|sign|agree|announce|open|close|evacuat|flood|earthquake|outbreak|discover|raise|cut|release|freeze|sanction|vote|protest|investigat|collapse|fire)\w*/gi;
const HIGH_RISK=/\b(killed|dead|casualt|alleged|accused|war crime|disputed|denied|claimed|reportedly)\b/i;
const WIRE=/\b(?:reporting by|reported by|source:|via|©)\s*(Reuters|Associated Press|AP|Agence France-Presse|AFP)\b/i;

export function plain(value){const named={nbsp:' ',amp:'&',quot:'"',apos:"'",rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',ndash:'–',mdash:'—'};return String(value||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(m,k)=>{if(k[0]==='#'){const hex=k[1]?.toLowerCase()==='x',n=parseInt(k.slice(hex?2:1),hex?16:10);return Number.isFinite(n)?String.fromCodePoint(n):m;}return named[k.toLowerCase()]??m;}).replace(/\s+/g,' ').trim();}
export function tokens(value){return new Set(plain(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>2&&!STOP.has(x)));}
export function completeSentences(value,{maxChars=4500,maxSentences=12}={}){
  const text=plain(value), raw=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)].map(x=>x.segment.trim()).filter(Boolean),pieces=[];let pending='';
  for(const part of raw){pending=pending?`${pending} ${part}`:part;const straight=(pending.match(/"/g)||[]).length,curlyOpen=(pending.match(/“/g)||[]).length,curlyClose=(pending.match(/”/g)||[]).length;if(straight%2===0&&curlyOpen===curlyClose){pieces.push(pending);pending='';}}
  const complete=pieces.map(x=>x.replace(/^(.{30,240}?)\s+\1(?:\s+\1)?\s+/,'$1 ')).map(x=>x.trim()).filter(x=>/[.!?][”’"']?$/.test(x)&&x.length>=20&&!/(?:\.{2,}|…)[”’"']?$/.test(x));
  const out=[];let used=0;
  for(const sentence of complete){if(out.length>=maxSentences)break;if(sentence.length>1600)continue;if(used+sentence.length+(out.length?1:0)>maxChars)break;out.push(sentence);used+=sentence.length+(out.length?1:0);}
  return out;
}
export function coreText(article){const cleaned=plain(article.description||'').replace(/^[A-Z][A-Z\s.-]*,\s*Syria\s*\([^)]*Press[^)]*\)\s*[–—-]\s*/i,'');const first=completeSentences(cleaned,{maxChars:1200,maxSentences:1});return [article.title,...first].join(' ');}
export function classifyGeography(article,source={}){
  const core=coreText(article), locations=[];
  for(const [name,re,region] of PLACES)if(re.test(core))locations.push({name,region,confidence:article.title.match(re)?'high':'medium',evidence:article.title.match(re)?'title':'lead'});
  const unique=[...new Map(locations.map(x=>[x.name,x])).values()];
  const countries=[...new Set(unique.map(x=>x.name==='GTA'?'Canada':x.name))];
  const priorityRegions=new Set();for(const x of unique){if(x.name==='Syria')priorityRegions.add('Syria');if(x.name==='Bangladesh')priorityRegions.add('Bangladesh');if(x.name==='Ghana')priorityRegions.add('Ghana');if(x.name==='GTA')priorityRegions.add('GTA');if(x.region==='Middle East'||x.name==='Syria')priorityRegions.add('Middle East');if(x.name==='Canada')priorityRegions.add('Canada');}
  const scope=!unique.length?'uncertain':countries.length>1?'multi-country':unique.some(x=>x.name==='GTA')?'local':unique.some(x=>['Syria','Bangladesh','Ghana','Canada'].includes(x.name))?'national':'regional-or-national';
  return {eventLocations:unique,geographicScope:scope,affectedPopulationOrInstitution:extractActors(core).slice(0,8),publisherLocation:source.publisherLocation||null,priorityRegions:[...priorityRegions],confidence:!unique.length?'uncertain':unique.every(x=>x.confidence==='high')?'high':'medium'};
}
export function extractActors(value){const text=plain(value);const orgs=[...text.matchAll(/\b(?:UN|UNGA|NATO|EU|WHO|IMF|World Bank|Supreme Court|Central Bank|Parliament|Congress|Government|Army|Police|Ministry)(?:\s+(?:of|for)\s+[A-Z][\w-]+)?\b/g)].map(m=>m[0]);const names=[...text.matchAll(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2}\b/g)].map(m=>m[0]);return [...new Set([...orgs,...names])].filter(x=>!/^The |^A /.test(x));}
export function eventSignals(article,geo=classifyGeography(article)){
  const text=coreText(article), stem=x=>x.toLowerCase().replace(/(?:ed|ing|s)$/,''),action=[...text.matchAll(ACTIONS)].map(m=>stem(m[0])),headlineAction=[...String(article.title||'').matchAll(ACTIONS)].map(m=>stem(m[0])), place=geo.eventLocations.map(x=>x.name.toLowerCase()),placeWords=new Set(['syria','syrian','bangladesh','bangladeshi','ghana','ghanaian','canada','canadian','iran','iranian','israel','israeli','ethiopia','ethiopian','tigray','tigrayan','amhara','toronto','gaza','iraq','iraqi']),actor=extractActors(String(article.title||'')).map(x=>x.toLowerCase()).filter(x=>![...placeWords].some(p=>x===p||x.startsWith(`${p} `)));
  const nums=[...text.matchAll(/\b\d[\d,.]*(?:\s*(?:%|percent|million|billion|people|fighters|days|years))?\b/gi)].map(m=>m[0].toLowerCase());
  const terms=[...tokens(article.title)].map(x=>x.replace(/^tigrayan$/,'tigray').replace(/^ethiopian$/,'ethiopia').replace(/^syrian$/,'syria').replace(/^ghanaian$/,'ghana').replace(/^bangladeshi$/,'bangladesh').replace(/^canadian$/,'canada').replace(/^israeli$/,'israel').replace(/^iranian$/,'iran'));
  return {action:[...new Set(action)],headlineAction:[...new Set(headlineAction)],actor:[...new Set(actor)],place:[...new Set(place)],numbers:[...new Set(nums)],terms:[...new Set(terms)]};
}
const overlap=(a,b)=>{const A=new Set(a),B=new Set(b);return [...A].filter(x=>B.has(x)).length;};
export function compareEvents(a,b){
  const A=a.signals||eventSignals(a),B=b.signals||eventSignals(b),hours=Math.abs(Date.parse(a.publishedAt)-Date.parse(b.publishedAt))/36e5;
  const actors=overlap(A.actor,B.actor),places=overlap(A.place,B.place),actions=overlap(A.headlineAction||A.action,B.headlineAction||B.action),terms=overlap(A.terms,B.terms),numbers=overlap(A.numbers,B.numbers);
  const updateChain=/\b(arrest|charg|bail|appeal|trial|convict|sentence)\b/;const legalA=(A.headlineAction||A.action).some(x=>updateChain.test(x)),legalB=(B.headlineAction||B.action).some(x=>updateChain.test(x));
  const actionA=A.headlineAction||A.action,actionB=B.headlineAction||B.action,sameActionSet=actionA.length===actionB.length&&actionA.every(x=>actionB.includes(x));
  if(hours<=168&&actors>=1&&places>=1&&legalA&&legalB&&!sameActionSet)return {relation:'material-update',score:actors*3+places*2+terms,reason:'same principal actor and place in a later legal/procedural development'};
  const score=actors*3+places*2+actions*3+Math.min(terms,5)+numbers;
  if(hours<=72&&((places>=1&&((terms>=2&&actions>=1)||terms>=4)&&score>=6)||(places===0&&terms>=4&&actions>=1)))return {relation:'same-event',score,reason:`shared headline actors (${actors}), headline actions (${actions}), places (${places}) and specific title terms (${terms})`};
  return {relation:'distinct-or-uncertain',score,reason:'insufficient shared event signals for conservative merge'};
}
export function clusterArticles(articles,sourcesById=new Map()){
  const events=[];
  for(const raw of [...articles].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))){const source=sourcesById.get(raw.provenance?.feedId)||{};const article={...raw,geography:classifyGeography(raw,source)};article.signals=eventSignals(article,article.geography);let match=null;
    for(const event of events){const best=compareEvents(article,event.articles[0]);if(best.relation!=='distinct-or-uncertain'&&(!match||best.score>match.comparison.score))match={event,comparison:best};}
    if(match){match.event.articles.push(article);match.event.relations.push({articleId:article.id,relation:match.comparison.relation,reason:match.comparison.reason});}
    else events.push({id:`event:${crypto.createHash('sha256').update(article.title.toLowerCase()).digest('hex').slice(0,16)}`,articles:[article],relations:[{articleId:article.id,relation:'seed',reason:'first article in cluster'}]});
  }
  return events;
}
export function detectWireOrigin(text){const m=plain(text).match(WIRE);return m?m[1].replace('Associated Press','AP').replace('Agence France-Presse','AFP'):null;}
export function independentSourceCount(snapshots){const families=new Set();for(const s of snapshots){const wire=s.wireOrigin||detectWireOrigin(s.auditText);families.add(wire?`wire:${wire.toLowerCase()}`:`publisher:${s.publisherId}`);}return families.size;}
export function prepareEvidence(snapshot,{maxChars=4500,maxSentences=12}={}){const raw=completeSentences(snapshot.auditText||snapshot.feedDescription,{maxChars,maxSentences:maxSentences*3}).filter(x=>!/\b(?:agency is a .*news agency|agency deals with latest developments|agency is for all|all rights reserved)\b/i.test(x)),seen=new Set(),sentences=[];for(const sentence of raw){const key=sentence.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if([...seen].some(x=>key===x||key.startsWith(x)||x.startsWith(key)))continue;seen.add(key);sentences.push(sentence);if(sentences.length===maxSentences)break;}return {...snapshot,evidenceSentences:sentences,evidenceText:sentences.join(' '),previewOnly:snapshot.access!=='ok'||snapshot.bodySentenceCount===0,incompleteTailDiscarded:Boolean(snapshot.incompleteTail)};}
export function assessEvidence(prepared,allPrepared=[]){const text=prepared.evidenceText||'',titleTokens=[...tokens(prepared.pageTitle)],hit=titleTokens.filter(t=>tokens(text).has(t)).length;const actor=extractActors(`${prepared.pageTitle} ${text}`).length>0,action=ACTIONS.test(`${prepared.pageTitle} ${text}`);ACTIONS.lastIndex=0;const highRisk=HIGH_RISK.test(`${prepared.pageTitle} ${text}`),independent=independentSourceCount(allPrepared.length?allPrepared:[prepared]),attributed=/\b(said|according to|reported|claimed|announced|statement|officials?)\b/i.test(text);const reasons=[],warnings=[];if(prepared.evidenceSentences.length<2||text.length<180)reasons.push('too little complete accessible reporting');if(hit<Math.min(2,titleTokens.length))reasons.push('evidence does not clearly support the central headline');if(!actor)reasons.push('principal actor or institution is unclear');if(!action)reasons.push('central action or development is unclear');if(highRisk&&independent<2&&!attributed)reasons.push('high-risk or disputed claim lacks both independent corroboration and explicit attribution');else if(highRisk&&independent<2)warnings.push('single-source high-risk claim; retain explicit attribution and uncertainty');return {adequate:reasons.length===0,reasons,warnings,highRisk,independentSourceFamilies:independent};}
export function scoreEvent(event,now=Date.now()){
  const primary=[...event.articles].sort((a,b)=>(b.description?.length||0)-(a.description?.length||0))[0],text=`${primary.title} ${primary.description||''}`,regions=new Set(event.articles.flatMap(a=>a.geography.priorityRegions));let region=0;if(regions.has('Syria'))region=25;else if(regions.has('GTA'))region=18;else if(['Bangladesh','Ghana','Middle East'].some(x=>regions.has(x)))region=15;else if(regions.has('Canada'))region=8;
  const age=Math.max(0,(now-Date.parse(primary.publishedAt))/36e5),fresh=Math.max(0,20-age/4),importance=Math.min(30,((text.match(/\b(war|attack|killed|ceasefire|election|referendum|constitutional|supreme court|central bank|inflation|trade|sanction|earthquake|flood|wildfire|outbreak|evacuation|energy security|peace agreement|climate|mass arrest|united nations|prime minister|president)\b/gi)||[]).length)*6),interest=Math.min(12,((text.match(/\b(science|space|archaeolog|culture|research|technology|history|discovery)\b/gi)||[]).length)*4),multi=new Set(event.articles.map(a=>a.sourceId)).size>1?7:0,minor=/\bopens? (?:a )?(?:new )?(?:sub-)?branch\b|\bfull statement\b|\bhow to (?:watch|catch)\b|\bdonat(?:e|es|ed|ion)\b|\bexplore partnership\b|\bcourtesy call\b|\binaugurat(?:e|es|ed|ion)\b/i.test(text)?-25:0,commentary=/\/(opinion|commentisfree|commentary|column)\//i.test(primary.url||'')||/\bwhat (?:we|you) need to know\b|\bwho pays\b|\bhow do we\b/i.test(primary.title)?-35:0,lowValue=minor+commentary;return {...event,primary,regions:[...regions],score:Number((region+fresh+importance+interest+multi+lowValue).toFixed(2)),scoreParts:{region,fresh:Number(fresh.toFixed(2)),importance,interestingness:interest,multiSourceSignal:multi,lowValuePenalty:lowValue}};
}
