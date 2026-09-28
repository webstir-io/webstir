import { db } from '../db/app-database.js';
import type { Database } from '../db/database.js';
import { email, type Email } from '../email/index.js';
import { files, type Files } from '../files/index.js';
import { jobs, type Jobs } from '../jobs/index.js';

/** The batteries every handler and view loader gets on its context. */
export interface AppServices {
  readonly db: Database;
  readonly jobs: Jobs;
  readonly email: Email;
  readonly files: Files;
}

export const appServices: AppServices = { db, jobs, email, files };
