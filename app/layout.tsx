import './globals.css';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
export const metadata = {title:'Seguimiento de Ruta · Seguridad en cada kilómetro',description:'Gestión preventiva de velocidad y viajes SST'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="es"><body>{children}</body></html>}
