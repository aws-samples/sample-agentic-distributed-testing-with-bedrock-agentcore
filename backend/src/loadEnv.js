/**
 * Loads the repo-root .env into process.env before anything else runs.
 *
 * Only docker-compose reads .env automatically — `npm run dev`/`npm start`
 * don't. Must be imported first (side-effect only, no exports) so its
 * module body executes before state/store.js reads process.env — ES module
 * imports are hoisted, so a dotenv.config() call inside index.js itself
 * would run too late, after sibling imports like store.js already evaluated.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
