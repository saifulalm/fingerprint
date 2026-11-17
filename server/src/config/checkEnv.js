// This file auto-generates .env from .env.example if .env doesn't exist
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../../.env');
const examplePath = path.join(__dirname, '../../.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('[config] .env created from .env.example — please edit it with your real credentials');
  }
}
