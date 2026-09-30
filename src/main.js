import { loadRound } from './state.js';
import { wireEvents } from './ui/dom.js';
import { resize } from './ui/canvas.js';

wireEvents();
loadRound();
resize();
