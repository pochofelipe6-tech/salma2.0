import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

const admin={id:'22222222-2222-4222-8222-222222222222',name:'Camila Rojas',email:'camila@example.com',role:'admin'};
const trips=[
  {id:1,user_id:'u1',plate:'ABC123',driver:'Andrea Pérez',zone:'urbana',sector:'Centro',started:'2026-11-12T13:00:00.000Z',ended:'2026-11-12T14:00:00.000Z'},
  {id:2,user_id:'u2',plate:'XYZ987',driver:'Luis Gómez',zone:'nacional',sector:'Vía al mar',started:'2026-11-12T15:00:00.000Z',ended:null},
];
const events=[
  {id:1,plate:'ABC123',driver:'Andrea Pérez',zone:'urbana',sector:'Centro',speed:62.4,limit_speed:50,created:'2026-11-12T13:20:00.000Z',lat:10.96,lng:-74.78},
  {id:2,plate:'XYZ987',driver:'Luis Gómez',zone:'nacional',sector:'Vía al mar',speed:88,limit_speed:70,created:'2026-11-11T10:00:00.000Z',lat:11.01,lng:-74.85},
];

async function mockAdmin(page:Page,{withData=true}={}){
  let currentTrips=withData?[...trips]:[];
  let vehicles=withData?[{id:1,user_id:admin.id,plate:'ABC123',model:'Renault Duster',driver:'Andrea Pérez'}]:[];
  const saved:unknown[]=[];
  let loggedOut=false;
  await page.clock.setFixedTime(new Date('2026-11-12T16:00:00Z'));
  await page.route('**/api/**',async route=>{
    const action=new URL(route.request().url()).pathname.split('/').pop();
    if(action==='state')return loggedOut?route.fulfill({status:401,json:{error:'Inicia sesión para continuar.'}}):route.fulfill({json:{user:admin,vehicles,trips:currentTrips,events:withData?events:[]}});
    if(action==='vehicle'){
      const body=route.request().postDataJSON();saved.push(body);
      vehicles=[...vehicles,{id:2,user_id:admin.id,plate:body.plate,model:body.model,driver:admin.name}];
      return route.fulfill({json:{id:2}});
    }
    if(action==='delete-trip'){
      const body=route.request().postDataJSON();currentTrips=currentTrips.filter(t=>t.id!==body.trip);
      return route.fulfill({json:{ok:true}});
    }
    if(action==='delete-vehicle'){
      const body=route.request().postDataJSON();vehicles=vehicles.filter(v=>v.id!==body.vehicle);
      return route.fulfill({json:{ok:true}});
    }
    if(action==='logout'){loggedOut=true;return route.fulfill({json:{ok:true}})}
    return route.fulfill({json:{ok:true}});
  });
  return {saved};
}
const noHorizontalScroll=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);

test('administrador ve el panel de seguridad vial con indicadores, límites ilustrados y alertas',async({page})=>{
  await mockAdmin(page);
  await page.setViewportSize({width:1672,height:941});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
  await expect(page.getByText('CONTROL Y PREVENCIÓN')).toBeVisible();
  await expect(page.getByText('12 de noviembre de 2026')).toBeVisible();
  await expect(page.getByText('Sistema activo')).toBeVisible();
  await expect(page.getByText('1 en curso')).toBeVisible();
  await expect(page.getByText('1 durante el día de hoy')).toBeVisible();
  for(const zone of ['Zona urbana','Vía nacional','Curvas','Escolar / residencial'])await expect(page.getByRole('heading',{name:zone,exact:true})).toBeVisible();
  const illustrations=page.locator('img[src^="/images/admin/zona-"]');
  await expect(illustrations).toHaveCount(4);
  for(const image of await illustrations.all())await expect.poll(()=>image.evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);
  await expect(page.getByRole('heading',{name:'Últimas alertas'})).toBeVisible();
  await expect(page.getByText('62 km/h')).toBeVisible();
  await expect(page.getByRole('button',{name:'Alertas 2'})).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({path:'artifacts/admin-desktop.png',fullPage:true});
});

test('pestañas del administrador: viajes, registro de vehículo, búsqueda de alertas, CSV y cierre de sesión',async({page})=>{
  const mock=await mockAdmin(page);
  await page.goto('/');
  await page.getByRole('button',{name:'Viajes',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Viajes de la flota'})).toBeVisible();
  await expect(page.getByText('En curso',{exact:true})).toBeVisible();
  await expect(page.getByText('Finalizado',{exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Vehículos',exact:true}).click();
  await page.getByRole('button',{name:'Agregar vehículo'}).click();
  await page.getByLabel('Placa').fill('QWE321');
  await page.getByLabel('Marca y modelo').fill('Chevrolet Onix 2025');
  await page.getByRole('button',{name:'Guardar vehículo'}).click();
  await expect(page.getByRole('heading',{name:'QWE321'})).toBeVisible();
  expect(mock.saved).toEqual([{plate:'QWE321',model:'Chevrolet Onix 2025'}]);

  await page.getByRole('button',{name:'Alertas 2'}).click();
  await expect(page.getByRole('heading',{name:'Registro de alertas'})).toBeVisible();
  const search=page.getByLabel('Buscar alertas');
  await search.fill('vía nacional');
  await expect(page.getByText('88 km/h')).toBeVisible();
  await expect(page.getByText('62 km/h')).toHaveCount(0);
  await search.fill('sin coincidencias');
  await expect(page.getByRole('heading',{name:'No encontramos coincidencias'})).toBeVisible();

  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exportar CSV'}).click();
  const file=await download;
  expect(file.suggestedFilename()).toBe('seguimiento-de-ruta-alertas.csv');
  const csv=readFileSync((await file.path())!,'utf8');
  expect(csv).toContain('"Placa";"Conductor";"Zona"');
  expect(csv).toContain('"XYZ987";"Luis Gómez";"nacional"');

  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await expect(page.getByLabel('Contraseña',{exact:true})).toBeVisible();
});

test('administrador en el celular: navegación horizontal, cierre de sesión visible y sin desbordamiento',async({page})=>{
  await mockAdmin(page,{withData:false});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Panel de seguridad vial'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Cerrar sesión'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Sin alertas recientes'})).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({path:'artifacts/admin-mobile.png',fullPage:true});
});


for(const kind of ['vehicle','trip'] as const){
 test('admin confirma y cancela eliminar '+kind+' con alerta visual',async({page})=>{
  await mockAdmin(page);await page.goto('/');
  await page.getByRole('button',{name:kind==='trip'?'Viajes':'Vehículos',exact:true}).click();
  const remove=page.getByRole('button',{name:kind==='trip'?'Eliminar ruta 1':'Eliminar vehículo ABC123',exact:true});
  await remove.click();const modal=page.getByRole('dialog');await expect(modal).toBeVisible();
  await modal.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(modal).not.toBeVisible();await expect(remove).toBeVisible();
  await remove.click();
  if(kind==='trip')await expect(modal).toContainText('posiciones GPS y alertas');
  await page.screenshot({path:'artifacts/admin-delete-'+kind+'.png'});
  await modal.getByRole('button',{name:'Sí, eliminar',exact:true}).click();
  await expect(modal).toContainText(kind==='trip'?'¡Ruta eliminada!':'¡Vehículo eliminado!');
  await modal.getByRole('button',{name:'Aceptar',exact:true}).click();await expect(modal).not.toBeVisible();await expect(remove).toHaveCount(0);
 });
}
test('error al eliminar se muestra dentro de la alerta',async({page})=>{
 await mockAdmin(page);await page.route('**/api/delete-trip',route=>route.fulfill({status:503,json:{error:'No se pudo eliminar la ruta.'}}));
 await page.goto('/');await page.getByRole('button',{name:'Viajes',exact:true}).click();
 await page.getByRole('button',{name:'Eliminar ruta 1',exact:true}).click();
 const modal=page.getByRole('dialog');await modal.getByRole('button',{name:'Sí, eliminar',exact:true}).click();
 await expect(modal).toContainText('No se pudo eliminar la ruta.');await modal.getByRole('button',{name:'Aceptar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Eliminar ruta 1',exact:true})).toBeVisible();
});

test('tarjetas del resumen abren su informacion',async({page})=>{
 await mockAdmin(page);await page.goto('/');
 for(const [card,title] of [['Vehículos registrados','Vehículos registrados'],['Viajes realizados','Historial de viajes'],['Alertas registradas','Registro de alertas'],['Zonas preventivas','Límites que protegen']]){
   await page.getByRole('button',{name:'Resumen',exact:true}).click();
   await page.getByRole('button',{name:new RegExp(card)}).click();
   const heading=page.getByRole('heading',{name:title,exact:true});await expect(heading).toBeVisible();await expect(heading).toBeFocused();
 }
});
