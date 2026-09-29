import { z } from 'zod';

import {
  defineView,
  flashSchema,
  formStateSchema,
  formView,
  routeDefinitionSchema,
  viewDefinitionSchema,
  type SSRContext,
} from '@webstir-io/module-contract';

// A page that binds its messages and one form. The loader leaves `flash` out: the framework adds it.
const notesData = z.object({
  flash: flashSchema,
  add: formStateSchema(['title', 'body']),
});

export const notesView = defineView<SSRContext, undefined, typeof notesData>({
  definition: { name: 'notes', path: '/notes', page: 'notes', auth: { role: 'editor' } },
  data: notesData,
  load: (ctx) => ({ add: formView(ctx.forms.read('add-note'), ['title', 'body'] as const) }),
});

// Only an editor may post the form, whose state the page reads as `add-note`.
export const addNoteDefinition = routeDefinitionSchema.parse({
  name: 'addNote',
  method: 'POST',
  path: '/notes',
  auth: { role: 'editor' },
  form: { id: 'add-note', csrf: true },
});

// Anyone signed in may see a page that says `required`.
viewDefinitionSchema.parse({ name: 'home', path: '/', auth: 'required' });
