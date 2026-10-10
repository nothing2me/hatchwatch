// Entry point for the motion page (motion.html, served at /motion).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MotionView from './MotionView.jsx';
import '../styles.css';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <MotionView />
    </StrictMode>
);
