// El Host recibido conserva el dominio visible cuando Next se ejecuta detrás
// de un proxy y request.url usa una dirección interna (por ejemplo 0.0.0.0).
export function isAllowedOrigin(request:Request):boolean {
  const origin=request.headers.get('origin');
  if(!origin)return true;
  if(request.headers.get('sec-fetch-site')==='cross-site')return false;
  try{
    const incoming=new URL(origin);
    if(!['https:','http:'].includes(incoming.protocol)||origin!==incoming.origin)return false;
    const internal=new URL(request.url);
    const forwardedProtocol=request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
    const protocol=forwardedProtocol==='https'||forwardedProtocol==='http'?forwardedProtocol+':':internal.protocol;
    const host=request.headers.get('host')||internal.host;
    return incoming.origin===new URL(`${protocol}//${host}`).origin;
  }catch{return false}
}
