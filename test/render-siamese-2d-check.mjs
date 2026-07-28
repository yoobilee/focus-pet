import fs from 'node:fs';
import { createAnimal } from '../windows/shared/animal-engine.js';
import { MiniCanvas } from './mini-canvas.mjs';

const SCALE = 6;
const size = 96 * SCALE;
const canvas = new MiniCanvas(size, size);
canvas.fillBackground('#3a3a44');
canvas.scale(SCALE, SCALE);
const anim = createAnimal('cat_siamese');
anim.draw(canvas);
fs.writeFileSync('test/siamese-2d-check.png', canvas.toPNG());
console.log('wrote test/siamese-2d-check.png');
