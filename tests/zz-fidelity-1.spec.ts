import {test} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';

const OUT='C:/Users/anfem/AppData/Local/Temp/claude/4fde62c78a3d09b6/15ff3a84-9553-4300-8612-73d9f85958d8/scratchpad/review/fidelity';
const user={id:'22222222-2222-4222-8222-222222222222',name:'Conductor',email:'a@example.com',role:'admin'};
const trips=[
  {id:1,user_id:'u1',plate:'ABC123',driver:'Andrea',zone:'urbana',sector:'Centro',started:'2026-11-12T13:00:00.000Z',ended:'2026-11-12T14:00:00.000Z'},
  {id:2,user_id:'u2',plate:'XYZ987',driver:'Luis',zone:'nacional',sector:'Via',started:'2026-11-12T12:00:00.000Z',ended:'2026-11-12T12:40:00.000Z'},
  {id:3,user_id:'u3',plate:'QWE321',driver:'Ana',zone:'curvas',sector:'Alto',started:'2026-11-12T15:00:00.000Z',ended:null},
];

test('fidelity measurements',async({page})=>{
  mkdirSync(OUT,{recursive:true});
  await page.clock.setFixedTime(new Date('2026-11-12T16:00:00Z'));
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/state')?{user,vehicles:[],trips,events:[]}:{ok:true}}));
  await page.setViewportSize({width:1672,height:941});
  await page.goto('/');
  await page.getByRole('heading',{name:'Panel de seguridad vial'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  await page.waitForTimeout(800);
  const fonts=await page.evaluate(()=>({dm:document.fonts.check('16px "DM Sans"'),man:document.fonts.check('800 16px Manrope'),loaded:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight)}));
  await page.screenshot({path:OUT+'/app-1672.png'});
  await page.screenshot({path:OUT+'/app-1672-full.png',fullPage:true});
  const data=await page.evaluate(()=>{
    const r=(el:Element|null)=>{if(!el)return null;const b=el.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
    const tr=(el:Element|null)=>{if(!el)return null;const range=document.createRange();range.selectNodeContents(el);const b=range.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
    const q=(s:string)=>document.querySelector(s);
    const qa=(s:string)=>[...document.querySelectorAll(s)];
    const cs=(el:Element|null,props:string[])=>{if(!el)return null;const c=getComputedStyle(el);return Object.fromEntries(props.map(p=>[p,c.getPropertyValue(p)]))};
    const c=(name:string)=>`[class*="${name}"]`;
    const out:Record<string,unknown>={};
    out.sidebar=r(q('aside'));
    out.brand=r(q(c('__brand')));out.brandSvg=r(q(c('__brand')+'>svg'));out.brandText=tr(q(c('__brand')+'>span'));out.sst=r(q(c('__brand')+'>b'));
    out.workspace=tr(q(c('__workspace')));
    out.nav=qa(c('__navItem')).map(b=>({r:r(b),svg:r(b.querySelector('svg')),text:(b as HTMLElement).innerText,badge:r(b.querySelector(c('__navBadge')))}));
    out.safety=r(q(c('__safety')));out.safetySvg=r(q(c('__safety')+'>svg'));out.safetyB=tr(q(c('__safety')+'>b'));out.safetyP=tr(q(c('__safety')+'>p'));
    out.profile=r(q(c('__profile')));out.avatar=r(q(c('__avatar')));out.profName=tr(q(c('__profile')+' b'));out.profRole=tr(q(c('__profile')+' small'));out.logout=r(q(c('__profile')+'>button svg'));
    out.topbar=r(q('header'));out.crumbs=r(q(c('__crumbs')));out.crumbSvg=r(q(c('__crumbs')+'>svg'));out.crumbB=tr(q(c('__crumbs')+' b'));out.status=r(q(c('__status')));out.statusDot=r(q(c('__status')+'>i'));out.topAvatar=r(q(c('__topAvatar')));
    out.hero=r(q(c('__hero')));out.eyebrow=tr(q(c('__eyebrow')));out.h1=tr(q('h1'));out.heroP=tr(q(c('__heroText')+' p'));out.heroArt=r(q(c('__heroArt')));out.date=r(q(c('__date')));out.dateSvg=r(q(c('__date')+'>svg'));
    out.stats=qa(c('__stat ')).length?[]:[];
    out.stats=qa('[class*="__stats"]>div').map(s=>({r:r(s),tile:r(s.querySelector(c('__tile'))),svg:r(s.querySelector('svg')),label:tr(s.querySelector(c('__statLabel'))),value:tr(s.querySelector('strong')),note:tr(s.querySelector('small'))}));
    out.sectionH2=tr(q(c('__sectionHead')+'>h2'));out.sectionSpan=tr(q(c('__sectionHead')+'>span'));
    out.zones=qa('[class*="__zones"]>div').map(z=>({r:r(z),img:r(z.querySelector('img')),h3:tr(z.querySelector('h3')),b:r(z.querySelector('b')),small:tr(z.querySelector('b>small')),span:tr(z.querySelector('div>span'))}));
    out.panel=r(q(c('__panel')));out.panelH2=tr(q(c('__panelHead')+' h2'));out.panelP=tr(q(c('__panelHead')+' p'));out.exportBtn=r(q(c('__outlineButton')));out.exportSvg=r(q(c('__outlineButton')+' svg'));
    out.thead=r(q('thead tr'));out.th=qa('thead th').map(th=>({r:r(th),t:tr(th)}));
    out.emptyIcon=r(q(c('__emptyIcon')));out.emptySvg=r(q(c('__emptyIcon')+' svg'));out.emptyH3=tr(q(c('__empty')+' h3'));out.emptyP=tr(q(c('__empty')+' p'));
    out.footer=r(q('footer'));out.doc={sh:document.documentElement.scrollHeight,sw:document.documentElement.scrollWidth};
    out.styles={
      navActive:cs(q(c('__active')),['background-image','font-weight','color','box-shadow','border-radius']),
      h1:cs(q('h1'),['font-family','font-size','font-weight','letter-spacing']),
      statValue:cs(q('[class*="__stats"]>div strong'),['font-family','font-size','font-weight']),
      zoneB:cs(q('[class*="__zones"]>div b'),['font-family','font-size','font-weight']),
      th:cs(q('thead th'),['font-size','font-weight','color','background-color']),
    };
    return out;
  });
  writeFileSync(OUT+'/rects.json',JSON.stringify({fonts,data},null,1));
});
