import type {Feature,FeatureCollection,LineString,Point} from 'geojson';
import {decodePlaces,decodeTile,tilesAround,type PlaceKind,type TileData,type TileIndex} from './map-tiles';
import {roadGroup} from './map-3d-style';
import {createSchoolIndex,type OfficialSchools,type SchoolIndex} from './school-zones';

// Datos propios que se dibujan sobre los mapas 2D y 3D alrededor del centro: vías clasificadas con su zona SST
// (public/map-tiles), lugares de OpenStreetMap (colegios, iglesias, centros comerciales...) y colegios oficiales
// (colegios-oficiales.json). Cada cuadrícula se descarga una sola vez.
// Los tramos a 80 m o menos de un colegio oficial se agregan como piezas «escolar» (official: true), igual que
// la regla que aplica el teléfono al reconocer la vía (lib/school-zones.ts).
export type PlaceProps={kind:PlaceKind;name:string;official:boolean};
export type RoadProps={id:string;zone:string;group:string;official?:boolean};
export type OverlayData={roads:FeatureCollection<LineString,RoadProps>;places:FeatureCollection<Point,PlaceProps>};

const M=111195,STEP=8;
// Piezas de una vía que quedan a 80 m o menos de un colegio oficial (muestreo cada 8 m).
function schoolPieces(road:Feature<LineString,RoadProps>,kind:string,schools:SchoolIndex):Feature<LineString,RoadProps>[]{
  if(road.properties.zone==='escolar'||['motorway','motorway_link'].includes(kind))return [];
  const pieces:Feature<LineString,RoadProps>[]=[];let run:number[][]=[];
  const close=()=>{if(run.length>1)pieces.push({type:'Feature',properties:{...road.properties,id:road.properties.id+'#escolar'+pieces.length,zone:'escolar',official:true},geometry:{type:'LineString',coordinates:run}});run=[]};
  const line=road.geometry.coordinates;
  for(let i=1;i<line.length;i++){
    const [a,b]=[line[i-1],line[i]],kx=M*Math.cos(a[1]*Math.PI/180),n=Math.max(1,Math.ceil(Math.hypot((b[0]-a[0])*kx,(b[1]-a[1])*M)/STEP));
    for(let s=i===1?0:1;s<=n;s++){
      const p=[a[0]+(b[0]-a[0])*s/n,a[1]+(b[1]-a[1])*s/n];
      if(schools.near(p[1],p[0]))run.push(p);else close();
    }
  }
  close();
  return pieces;
}

export function createMapOverlay(onData:(data:OverlayData)=>void,radius=2200,base='/map-tiles/'){
  const roads=new Map<string,Feature<LineString,RoadProps>>(),kinds=new Map<string,string>(),pieces=new Map<string,Feature<LineString,RoadProps>[]>();
  const places=new Map<string,Feature<Point,PlaceProps>>(),loaded=new Set<string>();
  let catalog:Promise<Set<string>>|null=null,official:Promise<boolean>|null=null,officialShown=false,schools:SchoolIndex=createSchoolIndex(null);
  const addPlace=(kind:PlaceKind,name:string,lng:number,lat:number,isOfficial:boolean)=>{
    const key=kind+':'+lng.toFixed(4)+':'+lat.toFixed(4);
    if(!places.has(key))places.set(key,{type:'Feature',properties:{kind,name,official:isOfficial},geometry:{type:'Point',coordinates:[lng,lat]}});
  };
  const json=async(url:string)=>{const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()};
  return async(lat:number,lng:number)=>{
    catalog??=json(base+'index.json').then((d:TileIndex)=>new Set(d.tiles)).catch(()=>{catalog=null;return new Set<string>()});
    official??=json(base+'colegios-oficiales.json').then((d:OfficialSchools)=>{
      schools=createSchoolIndex(d);
      for(const [name,slng,slat] of Array.isArray(d?.s)?d.s:[])if(typeof name==='string'&&Number.isFinite(slng)&&Number.isFinite(slat))addPlace('colegio',name,slng,slat,true);
      return true;
    }).catch(()=>{official=null;return false});
    const [keys,officialReady]=await Promise.all([catalog,official]);
    const wanted=tilesAround(lat,lng,radius).filter(k=>keys.has(k)&&!loaded.has(k));
    const firstOfficial=officialReady&&!officialShown;
    if(!wanted.length&&!firstOfficial)return;
    officialShown||=officialReady;
    for(const k of wanted)loaded.add(k);
    await Promise.all(wanted.map(async k=>{
      try{
        const data=await json(`${base}${k}.json`) as TileData;
        for(const s of decodeTile(data))if(!roads.has(s.id)){
          roads.set(s.id,{type:'Feature',properties:{id:s.id,zone:s.zone,group:roadGroup(s.kind||'')},geometry:{type:'LineString',coordinates:s.geometry}});
          kinds.set(s.id,s.kind||'');
        }
        for(const p of decodePlaces(data))addPlace(p.kind,p.name,p.lng,p.lat,false);
      }catch{loaded.delete(k)}
    }));
    // Piezas escolares de los colegios oficiales: una vez por vía (al llegar la vía o los colegios).
    if(officialShown)for(const [id,road] of roads)if(firstOfficial||!pieces.has(id))pieces.set(id,schoolPieces(road,kinds.get(id)||'',schools));
    const zonePieces=[...pieces.values()].flat();
    onData({roads:{type:'FeatureCollection',features:[...roads.values(),...zonePieces]},places:{type:'FeatureCollection',features:[...places.values()]}});
  };
}
