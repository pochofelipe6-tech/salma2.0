import {mkdir,writeFile,rename} from 'node:fs/promises';

// Preparación de datos; no usa las instancias públicas para seguimiento en vivo.
const endpoint=process.env.OVERPASS_DOWNLOAD_URL||'https://overpass.private.coffee/api/interpreter';
const query=`[out:json][timeout:90];
area["ISO3166-2"="CO-ATL"]["boundary"="administrative"]->.region;
(
way(area.region)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];
nwr(area.region)["amenity"="school"];
);out body geom;`;
await mkdir('data/maps',{recursive:true});
console.log('Consultando vías y colegios de Atlántico (CO-ATL)...');
const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(120000)});
if(!response.ok)throw new Error(`Overpass HTTP ${response.status}`);
const data=await response.json();
if(data.remark)throw new Error(`La consulta no se completó: ${data.remark}`);
if(!Array.isArray(data.elements)||!data.elements.length)throw new Error('La región no devolvió datos.');
await writeFile('data/maps/atlantico-osm.json.part',JSON.stringify(data));
await rename('data/maps/atlantico-osm.json.part','data/maps/atlantico-osm.json');
const roads=data.elements.filter(e=>e.type==='way'&&e.tags?.highway);
const schools=data.elements.filter(e=>e.tags?.amenity==='school');
const numericLimit=value=>typeof value==='string'&&/^\d+(?:\.\d+)?(?:\s*(?:km\/h|kph))?$/.test(value.trim());
const report={region:'Atlántico, Colombia',regionCode:'CO-ATL',downloadedAt:new Date().toISOString(),osmTimestamp:data.osm3s?.timestamp_osm_base,source:endpoint,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',roadWays:roads.length,schoolObjects:schools.length,roadsWithMaxspeedTag:roads.filter(e=>e.tags.maxspeed).length,roadsWithNumericMaxspeed:roads.filter(e=>numericLimit(e.tags.maxspeed)).length,roadsWithConditionalLimit:roads.filter(e=>Object.keys(e.tags).some(k=>k.startsWith('maxspeed:')&&k.includes('conditional'))).length,roadsWithSchoolZoneTag:roads.filter(e=>e.tags.school_zone==='yes'||e.tags.hazard==='school_zone').length,notes:['Los conteos corresponden a objetos OSM, no a kilómetros ni necesariamente a colegios únicos.','Un colegio cercano no define la extensión de una zona escolar ni su límite.','Un tipo highway no determina un límite legal.','No se deben interpretar límites condicionales como permanentes.','La descarga prepara datos; la detección automática todavía requiere integración y validación en campo.']};
await writeFile('data/maps/atlantico-coverage.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
