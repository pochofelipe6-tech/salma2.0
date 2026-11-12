import {test,expect,type Page} from '@playwright/test';

const user={id:'11111111-1111-4111-8111-111111111111',name:'Andrea Pérez',email:'andrea@example.com',role:'driver'};
const vehicle={id:1,user_id:user.id,plate:'ABC123',model:'Renault Duster',driver:user.name};
type GPSWindow=Window&{sendGps:(lat:number,lng:number,speed:number)=>void};

async function mockDriver(page:Page,{hasVehicle=true,denied=false,resume=false,accuracy=8}={}){
  let vehicles=hasVehicle?[vehicle]:[];
  let trip:Record<string,unknown>|null=resume?{id:7,user_id:user.id,vehicle_id:1,plate:'ABC123',driver:user.name,zone:'urbana',sector:'Centro',started:new Date().toISOString(),ended:null}:null;
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
    if(action==='start'){starts++;trip={id:7,user_id:user.id,vehicle_id:body.vehicle??null,plate:'Sin vehiculo asignado',driver:user.name,zone:body.zone||'urbana',sector:body.sector||'Recorrido GPS',started:new Date().toISOString(),ended:null};return reply({id:7,started:trip.started})}
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
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Ubicación en vivo',{exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'Mapa del recorrido GPS'})).toHaveAttribute('data-points','1');
  await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.6509,-74.0795,20));
  await expect(page.getByRole('img',{name:'Mapa del recorrido GPS'})).toHaveAttribute('data-points','2');
  await expect(page.getByText('Reduce la velocidad',{exact:true})).toBeVisible();
  await expect.poll(()=>mock.events.length).toBe(1);
  await page.screenshot({path:'artifacts/driver-active.png',fullPage:true});
  await page.getByRole('button',{name:'Finalizar ruta',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Ruta finalizada.');
  expect(mock.saved).toHaveLength(2);
  expect(mock.starts).toBe(1);
});

test('inicio directo sin formulario y permiso denegado no crea viaje',async({page})=>{
  const mock=await mockDriver(page,{hasVehicle:false,denied:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Iniciar ruta',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/driver-mobile.png',fullPage:true});
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
 await expect(page.getByText('Ubicación aproximada',{exact:true})).toBeVisible();
 await expect(page.getByText('Tu próximo camino empieza aquí',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Alertas en espera: falta velocidad fiable',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as unknown as GPSWindow).sendGps(4.65,-74.08,30));
 expect(mock.events).toHaveLength(0);expect(mock.saved).toHaveLength(0);
 await expect(page.getByRole('button',{name:'Probar sonido de alerta'})).toBeVisible();
});
