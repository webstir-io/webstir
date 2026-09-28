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

// One of each for every request, so each is frozen: an app that used to keep request values on
// ctx.db gets an error to move them to ctx.locals, rather than sharing them between requests.
for (const service of [db, jobs, email, files]) Object.freeze(service);

export const appServices: AppServices = Object.freeze({ db, jobs, email, files });
