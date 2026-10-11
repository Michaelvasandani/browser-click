import { createRoot } from 'react-dom/client';
import '@/lib/ui/base.css';
import './options.css';
import { Options } from './Options';

createRoot(document.getElementById('root')!).render(<Options />);
