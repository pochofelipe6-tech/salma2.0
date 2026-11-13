import {test,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';

const OUT='C:/Users/anfem/AppData/Local/Temp/claude/4fde62c78a3d09b6/15ff3a84-9553-4300-8612-73d9f85958d8/scratchpad/review/responsive';
mkdirSync(OUT+'/shots',{recursive:true});

const UID='22222222-2222-4222-8222-222222222222';
const iso=(d:string)=>new Date(d).toISOString();
const fullEvents=[
  {id:1,plate:'ABC123',driver:'María Fernanda Rodríguez Castañeda de la Hoz',zone:'escolar',sector:'Urbanización Villa Campestre, colegio San José de Calasanz',speed:47.6,limit_speed:30,created:iso('2026-11-12T13:20:00Z'),lat:10.963889,lng:-74.796387},
  {id:2,plate:'XYZ987',driver:'Luis Alberto Gómez Villalobos',zone:'nacional',sector:'Vía al mar, kilómetro 23 peaje Puerto Colombia',speed:118,limit_speed:70,created:iso('2026-11-12T15:05:00Z'),lat:11.01,lng:-74.85},
  {id:3,plate:'JKL4567',driver:'Andrea Pérez',zone:'curvas',sector:'Alto de Letras',speed:58.2,limit_speed:35,created:iso('2026-11-11T22:45:00Z'),lat:5.05,lng:-75.3},
  {id:4,plate:'MNO321',driver:'Juan Sebastián Echeverri Montoya',zone:'urbana',sector:'Calle 72 con Carrera 46, Centro Comercial Buenavista',speed:96,limit_speed:50,created:iso('2026-11-10T09:12:00Z'),lat:10.99,lng:-74.81},
  {id:5,plate:'PQR654',driver:'Ana',zone:'urbana',sector:'Centro',speed:52,limit_speed:50,created:iso('2026-11-09T11:00:00Z'),lat:10.97,lng:-74.78},
  {id:6,plate:'STU98765',driver:'Valentina Restrepo Arango',zone:'escolar',sector:'Barrio El Prado',speed:41,limit_speed:30,created:iso('2026-11-08T07:30:00Z'),lat:10.99,lng:-74.80},
];
const fullTrips=[
  {id:1,user_id:'u1',plate:'ABC123',driver:'María Fernanda Rodríguez Castañeda de la Hoz',zone:'escolar',sector:'Villa Campestre',started:iso('2026-11-12T13:00:00Z'),ended:iso('2026-11-12T14:00:00Z')},
  {id:2,user_id:'u2',plate:'XYZ987',driver:'Luis Alberto Gómez Villalobos',zone:'nacional',sector:'Vía al mar',started:iso('2026-11-12T15:00:00Z'),ended:null},
  {id:3,user_id:'u3',plate:'JKL4567',driver:'Andrea Pérez',zone:'curvas',sector:'Alto de Letras',started:iso('2026-11-11T20:00:00Z'),ended:iso('2026-11-11T23:30:00Z')},
  {id:4,user_id:'u4',plate:'MNO321',driver:'Juan Sebastián Echeverri Montoya',zone:'urbana',sector:'Centro',started:iso('2026-11-12T15:40:00Z'),ended:null},
];
const fullVehicles=[
  {id:1,user_id:'u1',plate:'ABC123',model:'Chevrolet NHR Reward Euro VI 2025 Furgón Refrigerado',driver:'María Fernanda Rodríguez Castañeda de la Hoz'},
  {id:2,user_id:'u2',plate:'XYZ987',model:'Renault Duster Intens 4x4 2024',driver:'Luis Alberto Gómez Villalobos'},
  {id:3,user_id:'u3',plate:'JKL4567',model:'Toyota Hilux',driver:'Andrea Pérez'},
];
const datasets:Record<string,unknown>={
  empty:{user:{id:UID,name:'Conductor',email:'a@example.com',role:'admin'},vehicles:[],trips:[],events:[]},
  full:{user:{id:UID,name:'María Fernanda de los Ángeles Rodríguez Castañeda',email:'a@example.com',role:'admin'},vehicles:fullVehicles,trips:fullTrips,events:fullEvents},
  huge:{user:{id:UID,name:'administrador.general@transportesdelcaribe.com.co',email:'a@example.com',role:'admin'},
    vehicles:Array.from({length:1234},(_,i)=>({id:i+1,user_id:'u',plate:'V'+i,model:'M',driver:'D'})),
    trips:Array.from({length:12345},(_,i)=>({id:i+1,user_id:'u',plate:'T'+i,driver:'D',zone:'urbana',sector:'S',started:iso('2026-11-12T10:00:00Z'),ended:i%3?iso('2026-11-12T11:00:00Z'):null})),
    events:Array.from({length:12345},(_,i)=>({id:i+1,plate:'E'+i,driver:'D',zone:['urbana','nacional','curvas','escolar'][i%4],sector:'S',speed:80,limit_speed:50,created:iso('2026-11-12T12:00:00Z'),lat:10,lng:-74}))},
};

async function mock(page:Page,data:unknown,time='2026-11-12T16:00:00Z',vehicleError?:string){
  await page.clock.setFixedTime(new Date(time));
  await page.route('**/api/**',route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('/state'))return route.fulfill({json:data});
    if(vehicleError&&p.endsWith('/vehicle'))return route.fulfill({status:400,json:{error:vehicleError}});
    return route.fulfill({json:{ok:true}});
  });
}

function measure(){
  const all=(n:string)=>[...document.querySelectorAll<HTMLElement>(`[class*="__${n}"]`)].filter(e=>[...e.classList].some(c=>c.endsWith('__'+n)));
  const one=(n:string)=>all(n)[0];
  const rr=(b:DOMRect)=>({l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)});
  const R=(el:Element|null|undefined)=>el?rr(el.getBoundingClientRect()):null;
  const shown=(el:Element|null|undefined)=>!!el&&el.getClientRects().length>0;
  const TR=(el:Node)=>{const g=document.createRange();g.selectNodeContents(el);return rr(g.getBoundingClientRect())};
  const txt=(el:Element)=>(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,50);
  const pad=(el:Element)=>{const s=getComputedStyle(el);return {l:parseFloat(s.paddingLeft),r:parseFloat(s.paddingRight)}};
  const cls=(e:Element)=>String((e as HTMLElement).className&&typeof (e as HTMLElement).className==='string'?(e as HTMLElement).className:'').replace(/admin-screen-module__[^_]+__/g,'');
  const o:Record<string,unknown>={vw:innerWidth,vh:innerHeight,docW:document.documentElement.scrollWidth,docH:document.documentElement.scrollHeight};
  o.docOverflow=document.documentElement.scrollWidth-innerWidth;
  // Hero
  const art=one('heroArt'),date=one('date'),h1=document.querySelector('h1'),hp=one('heroText')?.querySelector('p');
  const hero:Record<string,unknown>={artShown:shown(art),h1:h1?TR(h1):null,h1Lines:h1?Math.round(h1.getBoundingClientRect().height/parseFloat(getComputedStyle(h1).lineHeight)):0,p:hp?TR(hp):null};
  if(shown(art)&&shown(date)){
    const ab=art.getBoundingClientRect(),db=date.getBoundingClientRect();
    const tn=[...date.childNodes].find(n=>n.nodeType===3)!;
    const tb=TR(tn);
    hero.art=rr(ab);hero.date=rr(db);
    hero.dateText=(tn.textContent||'');hero.dateTextW=tb.w;
    hero.dateTextOverPad=Math.round(tb.r-(db.right-pad(date).r));
    hero.dateTextOutsideCard=Math.round(tb.r-db.right);
    hero.dateRelArt={x:Math.round(db.left-ab.left),y:Math.round(db.top-ab.top),w:Math.round(db.width),h:Math.round(db.height),artW:Math.round(ab.width),artH:Math.round(ab.height)};
    const opaque=ab.left+0.26*ab.width;
    hero.artLeft=Math.round(ab.left);hero.opaqueStart=Math.round(opaque);
    const h=hero.h1 as {r:number},p=hero.p as {r:number};
    hero.h1PastArtLeft=Math.round(h.r-ab.left);hero.h1OverOpaque=Math.round(h.r-opaque);hero.pOverOpaque=Math.round(p.r-opaque);
    hero.h1DateGap=Math.round(db.left-h.r);hero.pDateGap=Math.round(db.left-p.r);
    const stats=one('stats')||one('panel');
    hero.artBottomMinusNextTop=stats?Math.round(ab.bottom-stats.getBoundingClientRect().top):null;
  }
  o.hero=hero;
  // Stats
  o.stats=all('stat').map(s=>{const sb=s.getBoundingClientRect(),p=pad(s);
    return {w:Math.round(sb.width),h:Math.round(sb.height),parts:[...s.children].filter(c=>!cls(c).includes('tile')).map(c=>{const t=TR(c);const lh=parseFloat(getComputedStyle(c).lineHeight)||1;return {tag:c.tagName,text:txt(c),w:t.w,lines:Math.round(t.h/lh),overPad:Math.round(t.r-(sb.right-p.r)),outside:Math.round(t.r-sb.right)}})}});
  // Zones
  o.zones=all('zone').map(z=>{const zb=z.getBoundingClientRect(),p=pad(z);const d=z.querySelector('div')!;const db=d.getBoundingClientRect();const img=z.querySelector('img')!;
    return {w:Math.round(zb.width),h:Math.round(zb.height),img:R(img),textColW:Math.round(db.width),parts:[...d.children].map(c=>{const t=TR(c);return {tag:c.tagName,text:txt(c),w:t.w,h:t.h,colOverflow:Math.round(t.r-db.right),overPad:Math.round(t.r-(zb.right-p.r)),outside:Math.round(t.r-zb.right)}})}});
  // Tables
  o.tables=[...document.querySelectorAll('table')].map(t=>{const wrap=t.parentElement!;
    const ths=[...t.querySelectorAll('th')].map(th=>({text:txt(th),w:Math.round(th.getBoundingClientRect().width),textOver:Math.round(TR(th).r-(th.getBoundingClientRect().right-pad(th).r))}));
    const cells=[...t.querySelectorAll('td')].map(td=>{const tb=td.getBoundingClientRect();const right=tb.right-pad(td).r;
      const kids=[...td.childNodes].map(n=>{const t=TR(n);return {k:n.nodeType===3?'#text':(n as Element).tagName+(cls(n as Element)?'.'+cls(n as Element):''),text:(n.textContent||'').slice(0,40),over:Math.round(t.r-right)}}).filter(k=>k.over>0);
      return {col:(td as HTMLTableCellElement).cellIndex,row:(td.parentElement as HTMLTableRowElement).rowIndex,cellW:Math.round(tb.width),contentW:Math.round(tb.width-pad(td).l-pad(td).r),kids};}).filter(c=>c.kids.length);
    return {wrapW:wrap.clientWidth,tableScrollW:t.scrollWidth,wrapScroll:wrap.scrollWidth-wrap.clientWidth,ths,truncated:cells};});
  // Sidebar
  const sb=one('sidebar');const logout=document.querySelector('button[aria-label="Cerrar sesión"]');const prof=one('profile');
  const sideB=sb.getBoundingClientRect();
  const side:Record<string,unknown>={pos:getComputedStyle(sb).position,rect:rr(sideB),scrollH:sb.scrollHeight,clientH:sb.clientHeight,vOverflow:sb.scrollHeight-sb.clientHeight,hOverflow:sb.scrollWidth-sb.clientWidth,logout:R(logout)};
  if(logout){const lb=logout.getBoundingClientRect();side.logoutFullyVisible=lb.bottom<=Math.min(innerHeight,sideB.bottom)+0.5&&lb.right<=Math.min(innerWidth,sideB.right)+0.5&&lb.left>=sideB.left-0.5;}
  const nd=prof?.querySelector('div');
  if(shown(nd)){const b=nd!.querySelector('b')!;side.name={col:R(nd),text:TR(b),lines:Math.round(b.getBoundingClientRect().height/parseFloat(getComputedStyle(b).lineHeight||'20')),scroll:(nd as HTMLElement).scrollWidth-(nd as HTMLElement).clientWidth};}
  side.safety=R(one('safety'));side.nav=R(one('nav'));side.profile=R(prof);
  o.sidebar=side;
  // Nav (scroller on mobile)
  const nav=one('nav');const nb=nav.getBoundingClientRect();
  o.nav={scrollW:nav.scrollWidth,clientW:nav.clientWidth,overflowX:getComputedStyle(nav).overflowX,items:[...nav.children].map(b=>{const r=b.getBoundingClientRect();const vis=Math.max(0,Math.min(r.right,nb.right,innerWidth)-Math.max(r.left,nb.left,0));return {text:txt(b),l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),visible:+(vis/r.width).toFixed(2),textOver:Math.round(TR(b).r-r.right)}})};
  // Topbar
  const tb=one('topbar'),cr=one('crumbs'),st=one('status');
  o.topbar={h:Math.round(tb.getBoundingClientRect().height),crumbs:TR(cr),status:R(st),gap:Math.round(st.getBoundingClientRect().left-TR(cr).r),overflow:tb.scrollWidth-tb.clientWidth,statusTextOver:Math.round(TR(st).r-st.getBoundingClientRect().right)};
  // Panel/section heads
  o.heads=[...all('panelHead'),...all('sectionHead')].map(ph=>{const h2=ph.querySelector('h2')!;const other=ph.querySelector('button')||ph.querySelector(':scope>span');const a=TR(h2),b=other?R(other)!:null;
    return {h2:txt(h2),h2r:a,other:b,sameRow:b?Math.abs(a.t-b.t)<20:null,overlap:b?(a.r>b.l&&a.b>b.t&&a.t<b.b&&a.l<b.r):false};});
  // Vehicles
  o.vehicles=all('vehicle').map(v=>{const vb=v.getBoundingClientRect();return {w:Math.round(vb.width),parts:[...v.children].map(c=>({tag:c.tagName,over:Math.round(TR(c).r-vb.right)})).filter(p=>p.over>0)}});
  // Generic: elements extending beyond viewport (outside intended scrollers)
  const shell=one('shell');
  o.beyondViewport=[...shell.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();if(!r.width)return false;if(e.closest('[class*="__tableWrap"]'))return false;const inNav=e.closest('[class*="__nav"]');if(inNav&&getComputedStyle(nav).overflowX!=='visible')return false;return r.right>innerWidth+0.5||r.left<-0.5}).slice(0,12).map(e=>({tag:e.tagName,cls:cls(e),text:txt(e),r:R(e)}));
  // Generic: text nodes spilling outside their nearest block ancestor's border box (excluding tables)
  const spills:unknown[]=[];
  const walker=document.createTreeWalker(shell,NodeFilter.SHOW_TEXT);
  let n:Node|null;
  while((n=walker.nextNode())){
    if(!(n.textContent||'').trim())continue;
    const p=n.parentElement!;if(!shown(p)||p.closest('table'))continue;
    let blk:Element|null=p;while(blk&&getComputedStyle(blk).display.startsWith('inline'))blk=blk.parentElement;
    if(!blk)continue;
    const t=TR(n),bb=blk.getBoundingClientRect();
    const over=Math.round(t.r-bb.right),under=Math.round(bb.left-t.l);
    if(over>1||under>1)spills.push({text:(n.textContent||'').trim().slice(0,40),block:blk.tagName+'.'+cls(blk),over,under});
  }
  o.spills=spills.slice(0,20);
  return o;
}

async function settle(page:Page){
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}

const viewports:[number,number][]=[[2560,1440],[1920,1080],[1600,900],[1536,730],[1440,900],[1366,768],[1366,633],[1281,800],[1280,720],[1280,650],[1180,820],[1101,768],[1100,768],[1024,768],[900,768],[801,768],[800,768],[768,1024],[430,932],[390,844],[360,780]];
const tabNames=['Resumen','Viajes','Vehículos','Alertas'];

for(const ds of ['full','empty','huge']){
  test(`responsive sweep ${ds}`,async({page})=>{
    test.setTimeout(900000);
    await mock(page,datasets[ds]);
    await page.setViewportSize({width:1920,height:1080});
    await page.goto('/');
    await page.getByRole('heading',{name:'Panel de seguridad vial'}).waitFor();
    await settle(page);
    const results:Record<string,unknown>={};
    const tabsHere=ds==='huge'?['Resumen']:tabNames;
    for(const [w,h] of viewports){
      await page.setViewportSize({width:w,height:h});
      for(const tab of tabsHere){
        const i=tabNames.indexOf(tab);
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.locator('nav[aria-label="Secciones del panel"] button').nth(i).click();
        await page.evaluate(()=>{window.scrollTo(0,0);const n=document.querySelector('nav[aria-label="Secciones del panel"]');if(n)n.scrollLeft=0;});
        await settle(page);
        results[`${w}x${h}/${tab}`]=await page.evaluate(measure);
        const name=`${ds}-${w}x${h}-${tab}`.replace('í','i');
        await page.screenshot({path:`${OUT}/shots/${name}-vp.png`});
        if(ds!=='huge'||w<=1440)await page.screenshot({path:`${OUT}/shots/${name}-full.png`,fullPage:true});
      }
    }
    writeFileSync(`${OUT}/measure-${ds}.json`,JSON.stringify(results,null,1));
  });
}
