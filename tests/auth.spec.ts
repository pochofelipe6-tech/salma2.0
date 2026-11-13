import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('**/api/state',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Inicia sesión para continuar.'})}));
});

test('registro en escritorio, contraseña visible y confirmación por correo',async({page})=>{
  await page.setViewportSize({width:1720,height:914});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Crea tu cuenta de conductor'})).toBeVisible();
  await page.screenshot({path:'artifacts/auth-desktop.png',fullPage:true});
  await page.getByLabel('Nombre completo').fill('Conductor de prueba');
  await page.getByLabel('Correo electrónico').fill('conductor@example.com');
  const password=page.getByLabel('Contraseña',{exact:true});
  await password.fill('MiClaveSegura2026');
  await page.getByRole('button',{name:'Mostrar contraseña',exact:true}).click();
  await expect(password).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Ocultar contraseña',exact:true}).click();
  await expect(password).toHaveAttribute('type','password');
  let submitted:Record<string,unknown>|undefined;
  await page.route('**/api/register',route=>{
    submitted=route.request().postDataJSON();
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,confirmationRequired:true,message:'Revisa tu correo y confirma tu cuenta. Después vuelve aquí e inicia sesión.'})});
  });
  await page.getByRole('button',{name:'Crear cuenta',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bienvenido de nuevo'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('confirma tu cuenta');
  await expect(page.getByRole('list',{name:'Progreso del registro'})).toHaveCount(0);
  expect(submitted).toEqual({name:'Conductor de prueba',email:'conductor@example.com',password:'MiClaveSegura2026'});
});

test('vista móvil sin desbordamiento, ayuda y cambio de formulario',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Crea tu cuenta de conductor'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/auth-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Ayuda',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Estamos para orientarte'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Inicia sesión',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bienvenido de nuevo'})).toBeVisible();
  await expect(page.getByLabel('Nombre completo')).toHaveCount(0);
  await page.getByRole('button',{name:'Regístrate',exact:true}).click();
  await expect(page.getByLabel('Nombre completo')).toBeVisible();
});

test('registro con sesion entra directamente sin verificacion',async({page})=>{
 await page.route('**/api/register',async route=>{
  await page.route('**/api/state',r=>r.fulfill({json:{user:{id:'u1',name:'Andrea',email:'andrea@example.com',role:'driver'},vehicles:[],trips:[],events:[]}}));
  return route.fulfill({json:{ok:true}});
 });
 await page.goto('/');await page.getByLabel('Nombre completo').fill('Andrea');await page.getByLabel('Correo electrónico').fill('andrea@example.com');await page.getByLabel('Contraseña',{exact:true}).fill('abc123');
 await page.getByRole('button',{name:'Crear cuenta',exact:true}).click();await expect(page.getByRole('heading',{name:'Hola, Andrea'})).toBeVisible();
});
