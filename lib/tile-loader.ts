import {decodeTile,tileKey,tilesAround,type TileData,type TileIndex} from './map-tiles';
import type {SegmentIndex} from './road-matcher';

export type Coverage='ready'|'loading'|'outside'|'error';
// Descarga en el teléfono las cuadrículas alrededor de la posición (≈1,5 km) para reconocer
// la vía sin esperar al servidor en cada lectura GPS.
export function createTileLoader(index:SegmentIndex,onLoad:()=>void,base='/map-tiles/'){
  let catalog:Set<string>|null=null,catalogRequest:Promise<void>|null=null,catalogFailed=0;
  const loaded=new Set<string>(),loading=new Set<string>(),failed=new Map<string,number>();
  async function json(url:string){const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}
  function loadCatalog(){
    catalogRequest??=json(base+'index.json').then((data:TileIndex)=>{catalog=new Set(data.tiles);catalogFailed=0}).catch(()=>{catalogFailed=Date.now()}).finally(()=>{catalogRequest=null});
    return catalogRequest;
  }
  async function load(key:string){
    loading.add(key);
    try{index.add(decodeTile(await json(`${base}${key}.json`) as TileData));loaded.add(key);failed.delete(key);onLoad()}
    catch{failed.set(key,Date.now())}
    finally{loading.delete(key)}
  }
  async function ensure(lat:number,lng:number,metres=1500){
    if(!catalog){if(Date.now()-catalogFailed<5000)return;await loadCatalog();if(!catalog)return}
    const keys=catalog;
    // Primero la cuadrícula actual, luego las vecinas.
    const wanted=[tileKey(lng,lat),...tilesAround(lat,lng,metres)].filter((k,i,all)=>all.indexOf(k)===i&&keys.has(k)&&!loaded.has(k)&&!loading.has(k)&&Date.now()-(failed.get(k)||0)>8000);
    await Promise.all(wanted.map(load));
  }
  function coverage(lat:number,lng:number):Coverage{
    const key=tileKey(lng,lat);
    if(loaded.has(key))return 'ready';
    if(!catalog)return catalogFailed&&!catalogRequest?'error':'loading';
    if(!catalog.has(key))return 'outside';
    return failed.has(key)&&!loading.has(key)?'error':'loading';
  }
  return {ensure,coverage};
}
