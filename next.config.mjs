// @ts-check
/** @type {import('next').NextConfig} */
const nextConfig={
  // La API valida las alertas con las mismas cuadrículas que descarga el teléfono.
  outputFileTracingIncludes:{
    '/api/*':['./public/map-tiles/**/*.json','./assets/maps/atlantico-schools.json'],
  },
  async headers(){
    return [{source:'/map-tiles/:file*',headers:[{key:'Cache-Control',value:'public, max-age=3600, stale-while-revalidate=86400'}]}];
  },
};
export default nextConfig;
