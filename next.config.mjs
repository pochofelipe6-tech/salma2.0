// @ts-check
/** @type {import('next').NextConfig} */
const nextConfig={
  // La API valida las alertas con las mismas cuadrículas que descarga el teléfono.
  outputFileTracingIncludes:{
    '/api/*':['./public/map-tiles/**/*.json'],
  },
  async headers(){
    return [
      {source:'/map-tiles/:file*',headers:[{key:'Cache-Control',value:'public, max-age=3600, stale-while-revalidate=86400'}]},
      // App Android para descargar e instalar desde el celular (android/README.md).
      {source:'/RutaSST.apk',headers:[{key:'Content-Type',value:'application/vnd.android.package-archive'},{key:'Content-Disposition',value:'attachment; filename="RutaSST.apk"'},{key:'Cache-Control',value:'no-cache'}]},
    ];
  },
};
export default nextConfig;
