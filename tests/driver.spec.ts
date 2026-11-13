import {test,expect,type Page} from '@playwright/test';

const user={id:'11111111-1111-4111-8111-111111111111',name:'Andrea Pérez',email:'andrea@example.com',role:'driver'};
const vehicle={id:1,user_id:user.id,plate:'ABC123',model:'Renault Duster',driver:user.name};
type GPSWindow=Window&{sendGps:(lat:number,lng:number,speed:number)=>void};

async function mockDriver(page:Page,{hasVehicle=true,denied=false,resume=false,accuracy=8}={}){
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
  await page.screenshot({path:'artifacts/driver-active.png',fullPage:true});
  await page.getByRole('button',{name:'Finalizar ruta',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Ruta finalizada.');
  const completion=page.getByRole('dialog',{name:'¡Ruta finalizada!'});
  await expect(completion).toBeVisible();
  await expect(completion.getByText('2',{exact:true})).toBeVisible();
  await page.screenshot({path:'artifacts/route-completed.png',fullPage:true});
  await completion.getByRole('button',{name:'Aceptar',exact:true}).click();
  await expect(completion).not.toBeVisible();
  expect(mock.saved).toHaveLength(2);
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
