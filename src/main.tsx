import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Intercept and suppress verbose/unwanted TensorFlow Lite binary log outputs
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

const isTFLiteLog = (args: any[]): boolean => {
  return args.some(arg => 
    typeof arg === 'string' && (
      arg.includes('XNNPACK') ||
      arg.includes('TensorFlow Lite') ||
      arg.includes('mediapipe') ||
      arg.includes('WebAssembly') ||
      arg.includes('Initialized TensorFlow') ||
      arg.includes('delegate')
    )
  );
};

console.log = function(...args: any[]) {
  if (isTFLiteLog(args)) return;
  originalConsoleLog.apply(console, args);
};

console.info = function(...args: any[]) {
  if (isTFLiteLog(args)) return;
  originalConsoleInfo.apply(console, args);
};

console.warn = function(...args: any[]) {
  if (isTFLiteLog(args)) return;
  originalConsoleWarn.apply(console, args);
};

console.error = function(...args: any[]) {
  if (isTFLiteLog(args)) return;
  originalConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

