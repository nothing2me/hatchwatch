// Entry point for the phone camera page (camera.html, served at /camera).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CameraSender from './CameraSender.jsx';
import '../styles.css';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <CameraSender />
    </StrictMode>
);
