// Temporary review spec (parity / correctness / accessibility). Deleted after the review.
import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const OUT='C:/Users/anfem/AppData/Local/Temp/claude/4fde62c78a3d09b6/15ff3a84-9553-4300-8612-73d9f85958d8/scratchpad/review/parity';
mkdirSync(OUT,{recursive:true});
const log=(name:string,data:unknown)=>writeFileSync(`${OUT}/${name}.json`,JSON.stringify(data,null,2));
test.use({timezoneId:'America/Bogota',locale:'es-CO'});

const admin={id:'22222222-2222-4222-8222-222222222222',name:'Conductor',email:'a@example.com',role:'admin'};
const trips=[
  {id:3,user_id:'u1',plate:'ABC123',driver:'María Fernanda Rodríguez Castañeda',zone:'escolar',sector:'Centro',started:'2026-11-12T14:00:00.000Z',ended:null},
  {id:2,user_id:'u2',plate:'XYZ987',driver:'Luis Gómez',zone:'nacional',sector:'Vía al mar',started:'2026-11-12T13:00:00.000Z',ended:'2026-11-12T14:00:00.000Z'},
  {id:1,user_id:'u2',plate:'XYZ987',driver:'Luis Gómez',zone:'nacional',sector:'Vía al mar',started:'2026-11-10T13:00:00.000Z',ended:'2026-11-10T15:00:00.000Z'},
];
const events=[
  {id:7,plate:'ABC123',driver:'María Fernanda Rodríguez Castañeda',zone:'escolar',sector:'Barrio El Prado, Calle 72 con Carrera 54',speed:48.6,limit_speed:30,created:'2026-11-12T13:20:00.000Z',lat:10.9878,lng:-74.7889},
  {id:6,plate:'XYZ987',driver:'Luis "El Flaco" Gómez',zone:'nacional',sector:'=HYPERLINK("http://evil","x")',speed:88,limit_speed:70,created:'2026-11-12T12:00:00.000Z',lat:-4.2,lng:-69.94},
  {id:5,plate:'-KLM45',driver:'+Ana',zone:'urbana',sector:'@SUM(1)',speed:61,limit_speed:50,created:'2026-11-12T04:30:00.000Z',lat:4.6,lng:-74.08},
  {id:4,plate:'QWE321',driver:'Pedro',zone:'curvas',sector:'\t=1+1',speed:45,limit_speed:35,created:'2026-11-11T10:00:00.000Z',lat:6.25,lng:-75.56},
  {id:3,plate:'QWE321',driver:'Pedro',zone:'curvas',sector:'Alto de Letras',speed:44,limit_speed:35,created:'2026-11-10T10:00:00.000Z',lat:5.0,lng:-75.3},
  {id:2,plate:'QWE321',driver:'Pedro',zone:'urbana',sector:'Centro',speed:55,limit_speed:50,created:'2026-11-09T10:00:00.000Z',lat:4.7,lng:-74.1},
  {id:1,plate:'QWE321',driver:'Pedro',zone:'urbana',sector:'Centro',speed:57,limit_speed:50,created:'2026-11-08T10:00:00.000Z',lat:4.7,lng:-74.1},
];

type Opts={withData?:boolean;vehicleError?:string;logoutError?:boolean;now?:string};
async function mock(page:Page,opts:Opts={}){
  const withData=opts.withData??true;
  const s={vehicles:withData?[{id:1,user_id:admin.id,plate:'ABC123',model:'Renault Duster',driver:'María Fernanda Rodríguez Castañeda'}]:[] as {id:number;user_id:string;plate:string;model:string;driver:string}[],saved:[] as unknown[],stateCalls:0,console:[] as string[]};
  page.on('console',m=>{if(['error','warning'].includes(m.type()))s.console.push(m.type()+': '+m.text().slice(0,300))});
  page.on('pageerror',e=>s.console.push('pageerror: '+e.message));
  await page.clock.setFixedTime(new Date(opts.now||'2026-11-12T16:00:00Z'));
  await page.route('**/api/**',async route=>{
    const action=new URL(route.request().url()).pathname.split('/').pop();
    if(action==='state'){s.stateCalls++;return route.fulfill({json:{user:admin,vehicles:s.vehicles,trips:withData?trips:[],events:withData?events:[]}})}
    if(action==='vehicle'){
      const body=route.request().postDataJSON();s.saved.push(body);
      if(opts.vehicleError){await new Promise(r=>setTimeout(r,400));return route.fulfill({status:400,json:{error:opts.vehicleError}})}
      s.vehicles=[...s.vehicles,{id:s.vehicles.length+10,user_id:admin.id,plate:body.plate,model:body.model,driver:admin.name}];
      return route.fulfill({json:{ok:true,id:9}});
    }
    if(action==='logout')return opts.logoutError?route.fulfill({status:503,json:{error:'x'}}):route.fulfill({json:{ok:true}});
    return route.fulfill({json:{ok:true}});
  });
  return s;
}
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'Secciones del panel'}).getByRole('button',{name:new RegExp('^'+name)});

test('1 pestañas, estadísticas, top 5 vs todas, filtro oculto en Resumen',async({page})=>{
  const s=await mock(page);
  await page.setViewportSize({width:1672,height:941});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
  const stats=await page.locator('main strong').allInnerTexts();
  const notes=await page.locator('main small').allInnerTexts();
  const resumenRows=await page.locator('table tbody tr').count();
  const zoneSummary=await page.getByText(/^Zona urbana:/).locator('..').innerText().catch(()=>'(none)');
  const crumbs=await page.getByRole('navigation',{name:'Ubicación'}).innerText();
  await nav(page,'Alertas').click();
  const alertRows=await page.locator('table tbody tr').count();
  await page.getByLabel('Buscar alertas').fill('sin coincidencias');
  await expect(page.getByRole('heading',{name:'No encontramos coincidencias'})).toBeVisible();
  await nav(page,'Resumen').click();
  await expect(page.getByRole('heading',{name:'Últimas alertas'})).toBeVisible();
  const resumenAfterFilter={rows:await page.locator('table tbody tr').count(),searchVisible:await page.getByLabel('Buscar alertas').count(),emptyTitle:await page.locator('section h3').allInnerTexts()};
  await page.getByRole('heading',{name:'Últimas alertas'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${OUT}/filter-leak-resumen.png`,fullPage:true});
  await nav(page,'Viajes').click();
  const viajes={h1:await page.locator('h1').innerText(),crumbs:await page.getByRole('navigation',{name:'Ubicación'}).innerText(),rows:await page.locator('table tbody tr').allInnerTexts()};
  await nav(page,'Vehículos').click();
  const vehiculos={h1:await page.locator('h1').innerText(),cards:await page.locator('main h3').allInnerTexts()};
  log('1-tabs',{stats,notes,resumenRows,zoneSummary,crumbs,alertRows,resumenAfterFilter,viajes,vehiculos,console:s.console});
});

test('2 CSV: BOM, comillas, guardia de fórmulas, signos negativos',async({page})=>{
  await mock(page);
  await page.goto('/');
  await nav(page,'Alertas').click();
  await page.getByLabel('Buscar alertas').fill('pedro');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exportar CSV'}).click();
  const file=await download;
  const raw=readFileSync((await file.path())!);
  const text=raw.toString('utf8');
  writeFileSync(`${OUT}/export.csv`,raw);
  log('2-csv',{firstBytes:[...raw.subarray(0,4)].map(b=>b.toString(16)),lines:text.split('\r\n'),rowCount:text.split('\r\n').length-1});
});

test('3 vehículo: error de API, banner, valores conservados, cerrar',async({page})=>{
  const s=await mock(page,{vehicleError:'La placa ya está registrada.'});
  await page.goto('/');
  await nav(page,'Vehículos').click();
  await page.getByRole('button',{name:'Agregar vehículo'}).click();
  await page.getByLabel('Placa').fill('ABC123');
  await page.getByLabel('Marca y modelo').fill('Renault Duster');
  await page.getByRole('button',{name:'Guardar vehículo'}).click();
  const disabledWhileBusy=await page.getByRole('button',{name:'Guardar vehículo'}).isDisabled();
  await expect(page.getByRole('alert')).toContainText('La placa ya está registrada.');
  await page.screenshot({path:`${OUT}/vehicle-error.png`});
  const after={disabledWhileBusy,disabledAfter:await page.getByRole('button',{name:'Guardar vehículo'}).isDisabled(),plate:await page.getByLabel('Placa').inputValue(),model:await page.getByLabel('Marca y modelo').inputValue(),alertText:await page.getByRole('alert').innerText()};
  await page.getByRole('alert').getByRole('button',{name:'Cerrar'}).click();
  const alertGone=await page.getByRole('alert').count();
  // Logout while an error is showing: does the login screen inherit it?
  await page.getByLabel('Placa').fill('ABC123');
  await page.getByRole('button',{name:'Guardar vehículo'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await expect(page.getByLabel('Contraseña',{exact:true})).toBeVisible();
  const loginAlert=await page.getByRole('alert').allInnerTexts();
  await page.screenshot({path:`${OUT}/login-stale-error.png`});
  log('3-vehicle-error',{after,alertGone,loginAlert,saved:s.saved,console:s.console});
});

test('3b vehículo: alta correcta, foco tras guardar, formulario reiniciado',async({page})=>{
  const s=await mock(page);
  await page.goto('/');
  await nav(page,'Vehículos').click();
  await page.getByRole('button',{name:'Agregar vehículo'}).click();
  await page.getByLabel('Placa').fill('QWE321');
  await page.getByLabel('Marca y modelo').fill('Chevrolet Onix');
  await page.getByLabel('Marca y modelo').press('Enter');
  await expect(page.getByRole('heading',{name:'QWE321'})).toBeVisible();
  const focusAfter=await page.evaluate(()=>document.activeElement?.tagName+' '+(document.activeElement?.textContent||'').slice(0,30));
  const formOpen=await page.getByLabel('Placa').count();
  await page.getByRole('button',{name:'Agregar vehículo'}).click();
  const reset=await page.getByLabel('Placa').inputValue();
  const expanded=await page.getByRole('button',{name:'Agregar vehículo'}).getAttribute('aria-expanded');
  log('3b-vehicle-ok',{focusAfter,formOpen,reset,expanded,saved:s.saved,console:s.console});
});

test('4 teclado: orden de tabulación y anillo de foco',async({page})=>{
  await mock(page);
  await page.setViewportSize({width:1672,height:941});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
  const seq:unknown[]=[];
  for(let i=0;i<14;i++){
    await page.keyboard.press('Tab');
    seq.push(await page.evaluate(()=>{const e=document.activeElement as HTMLElement;const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return {tag:e.tagName,text:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40),focusVisible:e.matches(':focus-visible'),outline:`${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off ${cs.outlineOffset}`,box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]}}));
    const name=`focus-${String(i).padStart(2,'0')}`;
    const box=await page.evaluate(()=>{const r=(document.activeElement as HTMLElement).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});
    if(i<8)await page.screenshot({path:`${OUT}/${name}.png`,clip:{x:Math.max(0,box.x-20),y:Math.max(0,box.y-20),width:Math.min(600,box.w+40),height:box.h+40}});
  }
  // Activate a nav item by keyboard
  await page.getByRole('button',{name:/^Alertas/}).focus();
  await page.keyboard.press('Enter');
  const h1=await page.locator('h1').innerText();
  await page.getByLabel('Buscar alertas').focus();
  await page.keyboard.type('x');
  const sb=await page.getByLabel('Buscar alertas').boundingBox();
  await page.screenshot({path:`${OUT}/focus-search.png`,clip:{x:sb!.x-20,y:sb!.y-20,width:sb!.width+40,height:sb!.height+40}});
  const searchFocus=await page.getByLabel('Buscar alertas').evaluate(e=>{const cs=getComputedStyle(e);return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} border ${cs.borderColor}`});
  // Vehicle form focus ring
  await page.getByRole('button',{name:/^Vehículos/}).click();
  await page.getByRole('button',{name:'Agregar vehículo'}).click();
  await page.getByLabel('Placa').focus();
  const pb=await page.getByLabel('Placa').boundingBox();
  await page.screenshot({path:`${OUT}/focus-plate.png`,clip:{x:pb!.x-20,y:pb!.y-40,width:pb!.width+40,height:pb!.height+60}});
  log('4-keyboard',{seq,h1,searchFocus});
});

test('4b móvil: orden visual vs orden de tabulación',async({page})=>{
  await mock(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
  const seq:unknown[]=[];
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');seq.push(await page.evaluate(()=>{const e=document.activeElement as HTMLElement;const r=e.getBoundingClientRect();return {text:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30),x:Math.round(r.x),y:Math.round(r.y)}}))}
  await page.screenshot({path:`${OUT}/mobile-top.png`});
  log('4b-mobile',{seq});
});

for(const width of [1024,1180,1280,1366,1440,1536,1672]){
  test(`5 truncamiento en la tabla de alertas a ${width}px`,async({page})=>{
    await mock(page);
    await page.setViewportSize({width,height:900});
    await page.goto('/');
    await nav(page,'Alertas').click();
    await expect(page.getByRole('heading',{name:'Registro de alertas'})).toBeVisible();
    const cut=await page.evaluate(()=>{
      const out:string[]=[];
      document.querySelectorAll('table tbody td').forEach((td,i)=>{
        const el=td as HTMLElement;
        const inner=[el,...el.querySelectorAll('*')] as HTMLElement[];
        if(el.scrollWidth>el.clientWidth+1)out.push(`row${Math.floor(i/6)} col${i%6}: "${el.innerText.replace(/\n/g,' | ')}" scroll ${el.scrollWidth} > client ${el.clientWidth}`);
        void inner;
      });
      return out;
    });
    const docOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    await page.locator('table').first().screenshot({path:`${OUT}/table-${width}.png`});
    log(`5-trunc-${width}`,{cut,docOverflow});
  });
}

for(const [width,now] of [[1672,'2026-09-30T16:00:00Z'],[1366,'2026-09-30T16:00:00Z'],[1101,'2026-09-30T16:00:00Z'],[1672,'2026-11-12T16:00:00Z']] as const){
  test(`6 tarjeta de fecha ${width}px ${now.slice(0,10)}`,async({page})=>{
    await mock(page,{now});
    await page.setViewportSize({width,height:900});
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
    const m=await page.evaluate(()=>{
      const span=[...document.querySelectorAll('span')].find(s=>/ de 20\d\d$/.test(s.textContent||''))!;
      const r=span.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(span);const rr=[...range.getClientRects()];
      const textRight=Math.max(...rr.map(x=>x.right));const cs=getComputedStyle(span);
      return {text:span.textContent,visible:cs.display!=='none'&&r.width>0,cardLeft:r.left,cardRight:r.right,cardWidth:r.width,textRight,paddingRight:cs.paddingRight,overflowPx:Math.round(textRight-(r.right-parseFloat(cs.paddingRight))),scrollW:span.scrollWidth,clientW:span.clientWidth};
    });
    await page.screenshot({path:`${OUT}/date-${width}-${now.slice(0,10)}.png`,clip:{x:Math.max(0,width-560),y:0,width:Math.min(560,width),height:240}});
    log(`6-date-${width}-${now.slice(0,10)}`,m);
  });
}

async function contrastAudit(page:Page,name:string){
  const h=await page.evaluate(()=>document.documentElement.scrollHeight);
  const vp=page.viewportSize()!;
  await page.setViewportSize({width:vp.width,height:Math.min(h,4000)});
  await page.waitForTimeout(300);
  const items=await page.evaluate(()=>{
    const out:{text:string;cls:string;tag:string;color:string;size:number;weight:number;box:{l:number;t:number;r:number;b:number};opacity:number}[]=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let n:Node|null;
    while((n=walker.nextNode())){
      const t=(n.textContent||'').trim();if(!t)continue;
      const el=n.parentElement!;const cs=getComputedStyle(el);
      if(cs.visibility==='hidden')continue;
      const r=document.createRange();r.selectNodeContents(n);
      const rects=[...r.getClientRects()].filter(x=>x.width>1&&x.height>1);
      if(!rects.length)continue;
      let op=1;for(let e:Element|null=el;e;e=e.parentElement)op*=parseFloat(getComputedStyle(e).opacity);
      out.push({text:t.slice(0,48),cls:typeof el.className==='string'?el.className.split(' ')[0].replace(/^admin-screen-module__/,''):'',tag:el.tagName,color:cs.color,size:parseFloat(cs.fontSize),weight:Number(cs.fontWeight),opacity:op,
        box:{l:Math.min(...rects.map(x=>x.left)),t:Math.min(...rects.map(x=>x.top)),r:Math.max(...rects.map(x=>x.right)),b:Math.max(...rects.map(x=>x.bottom))}});
    }
    const ph=[...document.querySelectorAll('input[placeholder]')].map(i=>({text:'placeholder: '+(i as HTMLInputElement).placeholder,color:getComputedStyle(i,'::placeholder').color,bg:getComputedStyle(i).backgroundColor,size:parseFloat(getComputedStyle(i).fontSize)}));
    return {out,ph};
  });
  const style=await page.addStyleTag({content:'*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;transition:none!important}*::placeholder{color:transparent!important}svg{visibility:hidden!important}'});
  await page.waitForTimeout(200);
  const png=(await page.screenshot()).toString('base64');
  await style.evaluate(e=>e.parentNode?.removeChild(e));
  const res=await page.evaluate(async({png,items})=>{
    const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);
    const lin=(v:number)=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4};
    const L=(r:number,g:number,b:number)=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
    const parse=(s:string)=>s.match(/[\d.]+/g)!.map(Number);
    const rows=items.out.map(it=>{
      const x0=Math.max(0,Math.floor(it.box.l)),y0=Math.max(0,Math.floor(it.box.t)),w=Math.max(1,Math.min(c.width-x0,Math.ceil(it.box.r)-x0)),h=Math.max(1,Math.min(c.height-y0,Math.ceil(it.box.b)-y0));
      const d=ctx.getImageData(x0,y0,w,h).data;const [r,g,b,a=1]=parse(it.color);const al=a*it.opacity;
      const ratios:number[]=[];
      for(let i=0;i<d.length;i+=4){const br=d[i],bg=d[i+1],bb=d[i+2];const l1=L(r*al+br*(1-al),g*al+bg*(1-al),b*al+bb*(1-al)),l2=L(br,bg,bb);ratios.push((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05))}
      ratios.sort((p,q)=>p-q);const pct=(p:number)=>ratios[Math.min(ratios.length-1,Math.floor(p*ratios.length))];
      const large=it.size>=24||(it.size>=18.66&&it.weight>=700);
      // median background colour
      const mid=ctx.getImageData(Math.min(c.width-1,x0+1),Math.min(c.height-1,y0+Math.floor(h/2)),1,1).data;
      return {text:it.text,cls:it.cls,tag:it.tag,color:it.color,size:it.size,weight:it.weight,bgSample:`rgb(${mid[0]},${mid[1]},${mid[2]})`,min:+pct(0).toFixed(2),p05:+pct(0.05).toFixed(2),p50:+pct(0.5).toFixed(2),need:large?3:4.5};
    });
    const ph=items.ph.map(p=>{const [r,g,b]=parse(p.color),[R,G,B]=parse(p.bg);const l1=L(r,g,b),l2=L(R,G,B);return {...p,ratio:+((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)}});
    return {rows,ph};
  },{png,items});
  await page.setViewportSize(vp);
  log(`7-contrast-${name}`,{fails:res.rows.filter(r=>r.p05<r.need),all:res.rows,placeholders:res.ph});
}

for(const width of [1672,1280,1150]){
  test(`7 contraste ${width}px`,async({page})=>{
    await mock(page);
    await page.setViewportSize({width,height:941});
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({path:`${OUT}/resumen-${width}.png`});
    await contrastAudit(page,`resumen-${width}`);
    await nav(page,'Viajes').click();
    await contrastAudit(page,`viajes-${width}`);
    await nav(page,'Vehículos').click();
    await page.getByRole('button',{name:'Agregar vehículo'}).click();
    await contrastAudit(page,`vehiculos-${width}`);
    await nav(page,'Alertas').click();
    await contrastAudit(page,`alertas-${width}`);
  });
}

test('8 árbol de accesibilidad, landmarks, consola',async({page})=>{
  const s=await mock(page);
  await page.setViewportSize({width:1672,height:941});
  await page.goto('/?auth_error=1');
  await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
  const authErr=await page.getByRole('alert').allInnerTexts();
  const snap=await page.locator('body').ariaSnapshot();
  writeFileSync(`${OUT}/8-aria-resumen.yml`,snap);
  const landmarks=await page.evaluate(()=>({main:document.querySelectorAll('main').length,header:document.querySelectorAll('header').length,footer:document.querySelectorAll('footer').length,nav:[...document.querySelectorAll('nav')].map(n=>n.getAttribute('aria-label')+' links='+n.querySelectorAll('a').length+' buttons='+n.querySelectorAll('button').length),aside:document.querySelectorAll('aside').length,svgsWithoutAriaHidden:[...document.querySelectorAll('svg')].filter(x=>x.getAttribute('aria-hidden')!=='true').length,imgs:[...document.querySelectorAll('img')].map(i=>i.getAttribute('src')+' alt="'+i.getAttribute('alt')+'"'),headings:[...document.querySelectorAll('h1,h2,h3,h4')].map(h=>h.tagName+' '+h.textContent),ids:[...document.querySelectorAll('[id]')].map(e=>e.id),currents:[...document.querySelectorAll('[aria-current]')].map(e=>e.textContent+'='+e.getAttribute('aria-current')),mapLinks:[...document.querySelectorAll('a[target=_blank]')].map(a=>a.textContent+' | aria-label='+a.getAttribute('aria-label'))}));
  await page.getByRole('alert').getByRole('button',{name:'Cerrar'}).click();
  for(const t of ['Viajes','Vehículos','Alertas'])await nav(page,t).click();
  writeFileSync(`${OUT}/8-aria-alertas.yml`,await page.locator('body').ariaSnapshot());
  // reduced motion: any transitions/animations left?
  await page.emulateMedia({reducedMotion:'reduce'});
  const motion=await page.evaluate(()=>[...document.querySelectorAll('*')].map(e=>{const cs=getComputedStyle(e);return cs.animationName!=='none'?`${e.tagName}.${e.className} anim ${cs.animationName}`:(cs.transitionDuration!=='0s'?`${e.tagName}.${String(e.className).split(' ')[0]} transition ${cs.transitionProperty} ${cs.transitionDuration}`:'')}).filter(Boolean).slice(0,10));
  // Brand link behaviour
  await page.evaluate(()=>{(window as unknown as {marker:number}).marker=1});
  const brand=page.getByRole('link').first();
  const brandName=await brand.evaluate(a=>a.textContent);
  await brand.click();
  await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
  const reloaded=await page.evaluate(()=>(window as unknown as {marker?:number}).marker===undefined);
  log('8-a11y',{authErr,landmarks,motion,brandName,reloaded,stateCalls:s.stateCalls,console:s.console});
});

test('9 cierre de sesión con error y refresco de 15 s conserva estado',async({page})=>{
  test.setTimeout(60000);
  const s=await mock(page,{logoutError:true});
  await page.goto('/');
  await nav(page,'Alertas').click();
  await page.getByLabel('Buscar alertas').fill('pedro');
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const logoutErr=await page.getByRole('alert').innerText();
  const before=s.stateCalls;
  await expect.poll(()=>s.stateCalls,{timeout:25000}).toBeGreaterThan(before);
  const kept={tab:await page.locator('h1').innerText(),filter:await page.getByLabel('Buscar alertas').inputValue(),rows:await page.locator('table tbody tr').count()};
  log('9-logout-refresh',{logoutErr,before,after:s.stateCalls,kept,console:s.console});
});

test('10 estados vacíos',async({page})=>{
  await mock(page,{withData:false});
  await page.goto('/');
  const r={resumen:await page.locator('main h3').allInnerTexts(),summary:await page.getByText(/^Zona urbana:/).count()};
  await nav(page,'Viajes').click();
  const viajes=await page.locator('section h3').allInnerTexts();
  await nav(page,'Vehículos').click();
  const veh=await page.locator('section h3').allInnerTexts();
  await page.getByRole('button',{name:/Registrar vehículo/}).click();
  const formOpen=await page.getByLabel('Placa').count();
  await nav(page,'Alertas').click();
  await page.getByLabel('Buscar alertas').fill('zzz');
  const alertas=await page.locator('section h3').allInnerTexts();
  log('10-empty',{r,viajes,veh,formOpen,alertas});
});
