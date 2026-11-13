import {test,expect,type Page} from '@playwright/test';

const user={id:'11111111-1111-4111-8111-111111111111',name:'Andrea Pérez',email:'andrea@example.com',role:'driver'};
const vehicle={id:1,user_id:user.id,plate:'ABC123',model:'Renault Duster',driver:user.name};
type GPSWindow=Window&{sendGps:(lat:number,lng:number,speed:number)=>void};

async function mockDriver(page:Page,{hasVehicle=true,denied=false,resume=false,accuracy=8,limit=50,label='Zona urbana',zone='urbana',known=true}={}){
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=','base64')}));
  let vehicles=hasVehicle?[vehicle]:[];
  let trip:Record<string,unknown>|null=resume?{id:7,user_id:user.id,vehicle_id:1,plate:'ABC123',model:'Renault Duster',driver:user.name,zone:'urbana',sector:'Centro',started:new Date().toISOString(),ended:null}:null;
  const saved:Record<string,unknown>[]=[];
  const events:Record<string,unknown>[]=[];
  let starts=0;
  await page.addInitScript(({denied,accuracy})=>{
    let listener:PositionCallback|undefined;
    let time=Date.now();
    const position=(lat=4.65,lng=-74.08,speed=0)=>({coords:{latitude:lat,longitude:lng,accuracy,speed,altitude:null,altitudeAccuracy:null,heading:null,toJSON:()=>({})},timestamp:time,toJSON:()=>({})}) as GeolocationPosition;
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      getCurrentPosition:(success:PositionCallback,failure:PositionErrorCallback)=>denied?failure({code:1,message:'Denied',PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3}):success(position()),
      watchPosition:(callback:PositionCallback)=>{listener=callback;return 1},
      clearWatch:()=>{listener=undefined},
    }});
    (window as unknown as GPSWindow).sendGps=(lat,lng,speed)=>{time+=6000;listener?.(position(lat,lng,speed))};
  },{denied,accuracy});
  await page.route('**/api/**',async route=>{
    const request=route.request(),action=new URL(request.url()).pathname.split('/').pop();
    const body=request.method()==='POST'?request.postDataJSON():null;
    const reply=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(action==='state')return reply({user,vehicles,trips:trip?[trip]:[],events});
    if(action==='road')return reply({match:known?{status:'known',reason:'Registrado',roadId:'34377021',roadName:'Carrera 51B',zone,label,limit,source:'OpenStreetMap'}:{status:'unknown',reason:'La vía no tiene límite registrado.',limit:null}});
    if(action==='vehicle'){vehicles=[{...vehicle,plate:body.plate,model:body.model}];return reply({id:1})}
    if(action==='start'){starts++;trip={id:7,user_id:user.id,vehicle_id:body.vehicle??null,plate:body.plate,model:body.model,driver:user.name,zone:body.zone||'urbana',sector:body.sector||'Recorrido GPS',started:new Date().toISOString(),ended:null};vehicles=[{...vehicle,plate:body.plate,model:body.model}];return reply({id:7,started:trip.started,plate:body.plate,model:body.model})}
    if(action==='positions'){
      if(request.method()==='GET')return reply({points:resume?[{lat:4.65,lng:-74.08,accuracy:8,recorded_at:new Date().toISOString()}]:[]});
      saved.push(...body.points);return reply({ok:true});
    }
    if(action==='event'){events.push(body);return reply({ok:true})}
    if(action==='end'){trip=null;return reply({ok:true})}
    return reply({ok:true});
  });
  return {saved,events,get starts(){return starts}};
}

test('conductor ve solo su ruta, mapa y límites; inicia, dibuja y finaliza',async({page})=>{
  const mock=await mockDriver(page,{hasVehicle:false});
  await page.setViewportSize({width:1512,height:1050});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Hola, Andrea'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Resumen',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Vehículos',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Alertas',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Tu ruta en tiempo real'})).toBeVisible();
  for(const zone of ['Zona urbana','Vía nacional','Curvas','Escolar / residencial'])await expect(page.getByRole('heading',{name:zone,exact:true})).toBeVisible();
  await page.screenshot({path:'artifacts/driver-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  expect(mock.starts).toBe(0);
  await page.getByLabel('Placa',{exact:true}).fill('ABC123');
  await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('ABC123 · Renault Duster',{exact:true})).toBeVisible();
  await expect(page.getByText('Ubicación en vivo',{exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'Mapa del recorrido GPS'})).toHaveAttribute('data-points','1');
  await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.6509,-74.0795,20));
  await expect(page.getByRole('img',{name:'Mapa del recorrido GPS'})).toHaveAttribute('data-points','2');
  await expect(page.getByText('Reduce la velocidad',{exact:true})).toBeVisible();
  await expect.poll(()=>mock.events.length).toBe(1);
  const warning=page.getByRole('alert').filter({hasText:'¡Exceso de velocidad!'});
  await expect(warning).toBeVisible();await expect(warning).toContainText('72');await expect(warning).toContainText('50');
  await page.screenshot({path:'artifacts/driver-active-zones.png',fullPage:true});
  await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.6509,-74.0795,50/3.6));
  await expect(warning).toHaveCount(0);
  await page.getByRole('button',{name:'Finalizar ruta',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Ruta finalizada. Tu viaje'})).toBeVisible();
  const completion=page.getByRole('dialog',{name:'¡Ruta finalizada!'});
  await expect(completion).toBeVisible();
  await expect(completion.getByText('3',{exact:true})).toBeVisible();
  await page.screenshot({path:'artifacts/route-completed.png',fullPage:true});
  await completion.getByRole('button',{name:'Aceptar',exact:true}).click();
  await expect(completion).not.toBeVisible();
  expect(mock.saved).toHaveLength(3);
  expect(mock.starts).toBe(1);
});

test('inicio con vehiculo y permiso denegado no crea viaje',async({page})=>{
  const mock=await mockDriver(page,{hasVehicle:false,denied:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Iniciar ruta',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/driver-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  await page.getByLabel('Placa',{exact:true}).fill('ABC123');
  await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Permite el GPS'})).toContainText('Permite el GPS');
  expect(mock.starts).toBe(0);
});

test('un viaje abierto recupera su trazado y reanuda el GPS sin crear otro viaje',async({page})=>{
  const mock=await mockDriver(page,{resume:true});
  await page.goto('/');
  await expect(page.getByRole('img',{name:'Mapa del recorrido GPS'})).toHaveAttribute('data-points','1');
  await page.getByRole('button',{name:'Reanudar GPS',exact:true}).click();
  await expect(page.getByText('Ubicación en vivo',{exact:true})).toBeVisible();
  expect(mock.starts).toBe(0);
});

test('ubicacion imprecisa aparece en el mapa sin generar alertas ni guardar puntos inexactos',async({page})=>{
 const mock=await mockDriver(page,{accuracy:1500});await page.goto('/');
 await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  await page.getByLabel('Placa',{exact:true}).fill('ABC123');
  await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 await expect(page.getByText('Ubicación aproximada',{exact:true})).toBeVisible();
 await expect(page.getByText('Tu próximo camino empieza aquí',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Alertas en espera: falta velocidad fiable',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.65,-74.08,30));
 expect(mock.events).toHaveLength(0);expect(mock.saved).toHaveLength(0);
 await expect(page.getByRole('button',{name:'Probar sonido de alerta'})).toBeVisible();
});

test('centra el marcador en las coordenadas recibidas y vuelve tras desplazar el mapa',async({page})=>{
 await mockDriver(page,{accuracy:69});await page.goto('/');
 await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  await page.getByLabel('Placa',{exact:true}).fill('ABC123');
  await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 const map=page.getByRole('img',{name:'Mapa del recorrido GPS'});
 await expect(page.getByText('Tu ubicación',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(50.18036,14.20752,0));
 await expect.poll(async()=>Number(await map.getAttribute('data-center-lat'))).toBeCloseTo(50.18036,3);
 await expect.poll(async()=>Number(await map.getAttribute('data-center-lng'))).toBeCloseTo(14.20752,3);
 const bounds=(await map.boundingBox())!;
 const marker=(await page.getByText('Tu ubicación',{exact:true}).boundingBox())!;
 expect(marker.x).toBeGreaterThan(bounds.x);expect(marker.x+marker.width).toBeLessThan(bounds.x+bounds.width);
 expect(marker.y).toBeGreaterThan(bounds.y);expect(marker.y+marker.height).toBeLessThan(bounds.y+bounds.height);
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2+80);
 await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+150,bounds.y+bounds.height/2+100,{steps:12});await page.mouse.up();
 await expect(page.getByRole('button',{name:'Volver a mi ubicación'})).toBeVisible();
 await page.getByRole('button',{name:'Centrar en mi ubicación'}).click();
 await expect.poll(async()=>Number(await map.getAttribute('data-center-lat'))).toBeCloseTo(50.18036,3);
 await expect(page.getByRole('button',{name:'Volver a mi ubicación'})).toHaveCount(0);
});

for(const zone of [{id:'urbana',name:'Zona urbana',limit:50},{id:'nacional',name:'Vía nacional',limit:70},{id:'curvas',name:'Curvas',limit:35},{id:'escolar',name:'Escolar / residencial',limit:30}]){
 test('alerta usa el limite y nombre de '+zone.id,async({page})=>{
  const mock=await mockDriver(page,{limit:zone.limit,label:zone.name,zone:zone.id});await page.goto('/');
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  await page.getByLabel('Placa',{exact:true}).fill('ABC123');await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');
  await expect(page.getByLabel('Tipo de zona',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
  await expect(page.getByRole('button',{name:'Finalizar ruta',exact:true})).toBeVisible();
  const warning=page.getByRole('alert').filter({hasText:'¡Exceso de velocidad!'});
  await page.evaluate(limit=>(window as unknown as GPSWindow).sendGps(4.65,-74.08,(limit-1)/3.6),zone.limit);await expect(warning).toHaveCount(0);
  await page.evaluate(limit=>(window as unknown as GPSWindow).sendGps(4.65,-74.08,(limit+5)/3.6),zone.limit);
  await expect(page.locator(`[data-zone="${zone.id}"][data-active="true"]`)).toContainText('Zona actual');
  await expect(page.locator('[data-active="true"]')).toHaveCount(1);
  await expect(warning).toBeVisible();await expect(warning).toContainText(zone.name);await expect(warning).toContainText(zone.limit+' km/h');
  await expect.poll(()=>mock.events.length).toBe(1);expect(mock.events[0].speed).toBeGreaterThan(zone.limit);expect(mock.events[0].fix).toBeTruthy();
  await page.evaluate(limit=>(window as unknown as GPSWindow).sendGps(4.65,-74.08,(limit-1)/3.6),zone.limit);await expect(warning).toHaveCount(0);
 });
}

test('sin limite identificado no inventa alerta ni exige seleccion manual',async({page})=>{
 const mock=await mockDriver(page,{known:false});await page.goto('/');await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 await page.getByLabel('Placa',{exact:true}).fill('ABC123');await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');
 await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.65,-74.08,30));
 await expect(page.getByText('Límite no disponible',{exact:true})).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'¡Exceso de velocidad!'})).toHaveCount(0);expect(mock.events).toHaveLength(0);
});

test('el limite cambia automaticamente durante la misma ruta y se suspende sin datos',async({page})=>{
 await mockDriver(page);
 await page.route('**/api/road',route=>{
  const {fix}=route.request().postDataJSON();const limit=fix.lng< -74.0798?50:fix.lng< -74.079?30:null;
  return route.fulfill({json:{match:limit?{status:'known',roadId:String(limit),roadName:limit===50?'Avenida principal':'Calle residencial',zone:limit===50?'urbana':'escolar',label:limit===50?'Vía principal':'Vía residencial',limit,source:'OpenStreetMap'}:{status:'unknown',reason:'Sin dato registrado',limit:null}}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 await page.getByLabel('Placa',{exact:true}).fill('ABC123');await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 const warning=page.getByRole('alert').filter({hasText:'¡Exceso de velocidad!'});
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.65,-74.08,10));await expect(page.getByText('50 km/h · Vía principal',{exact:true})).toBeVisible();await expect(warning).toHaveCount(0);
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.65,-74.0795,10));await expect(warning).toBeVisible();await expect(warning).toContainText('Calle residencial');await expect(warning).toContainText('30 km/h');await expect(page.locator('[data-zone="escolar"][data-active="true"]')).toContainText('Zona actual');await expect(page.locator('[data-zone="urbana"][data-active="true"]')).toHaveCount(0);
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.65,-74.0785,10));await expect(warning).toHaveCount(0);await expect(page.getByText('Límite no disponible',{exact:true})).toBeVisible();await expect(page.locator('[data-active="true"]')).toHaveCount(0);
});

test('conserva posiciones y permite finalizar tras reparar la tabla GPS',async({page})=>{
 const mock=await mockDriver(page);let repaired=false;let savedAfterRepair=0;let ends=0;
 await page.route('**/api/positions',route=>{
  if(!repaired)return route.fulfill({status:503,json:{error:'Ejecuta supabase/migrations/002_route_points.sql para guardar el recorrido.'}});
  if(route.request().method()==='GET')return route.fulfill({json:{points:[]}});
  savedAfterRepair+=route.request().postDataJSON().points.length;return route.fulfill({json:{ok:true}});
 });
 await page.route('**/api/end',route=>{ends++;return route.fulfill({json:{ok:true}})});
 await page.goto('/');await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();await page.getByLabel('Placa',{exact:true}).fill('ABC123');await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'002_route_points.sql'})).toBeVisible();
 await page.getByRole('button',{name:'Finalizar ruta',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'002_route_points.sql'})).toBeVisible();expect(ends).toBe(0);
 repaired=true;
 await page.getByRole('button',{name:'Finalizar ruta',exact:true}).click();await expect(page.getByRole('dialog',{name:'¡Ruta finalizada!'})).toBeVisible();
 expect(savedAfterRepair).toBe(1);expect(ends).toBe(1);expect(mock.starts).toBe(1);
});

test('el GPS conserva el zoom elegido por el conductor',async({page})=>{
 await mockDriver(page);await page.goto('/');await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();await page.getByLabel('Placa',{exact:true}).fill('ABC123');await page.getByLabel('Marca y modelo',{exact:true}).fill('Renault Duster');await page.getByRole('button',{name:'Iniciar ruta',exact:true}).click();
 const map=page.getByRole('img',{name:'Mapa del recorrido GPS'});await expect(map).toHaveAttribute('data-center-lat');
 await page.getByTitle('Acercar mapa',{exact:true}).click();await expect(map).toHaveAttribute('data-zoom','17');await page.getByTitle('Acercar mapa',{exact:true}).click();
 await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBe(18);
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.6501,-74.0801,0));
 await expect.poll(async()=>Number(await map.getAttribute('data-center-lat'))).toBeCloseTo(4.6501,4);await expect(map).toHaveAttribute('data-zoom','18');
});

test('vista 3D muestra edificaciones y permite volver al mapa 2D',async({page})=>{
 await mockDriver(page);await page.goto('/');
 const toggle=page.getByRole('button',{name:'Ver edificaciones en 3D',exact:true});await expect(toggle).toBeEnabled({timeout:20000});
 await toggle.click();const map3d=page.getByRole('img',{name:'Mapa de edificaciones en 3D'});await expect(map3d).toHaveAttribute('data-buildings','ready',{timeout:20000});
 await expect(page.getByRole('img',{name:'Mapa del recorrido GPS'})).toHaveCount(0);
 await page.screenshot({path:'artifacts/buildings-3d-preview.png',fullPage:true});
 await page.getByRole('button',{name:'Ver mapa en 2D',exact:true}).click();await expect(map3d).toHaveCount(0);await expect(page.getByRole('img',{name:'Mapa del recorrido GPS'})).toBeVisible();
});
