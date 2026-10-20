import { createRoot } from 'react-dom/client';
import { LocalApp } from './app/LocalApp';
import { installZoomPolicy } from './ui/zoomPolicy';
installZoomPolicy();
createRoot(document.getElementById('root')!).render(<LocalApp />);
