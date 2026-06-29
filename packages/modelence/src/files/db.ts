import { Store } from '../data/store';
import { schema } from '../data/types';

/**
 * Metadata record for each file created through the built-in, owner-aware file
 * methods (`_system.files.requestUpload` and friends). One row per file — the
 * file's bytes live in Modelence Cloud storage; this row tracks who owns it.
 *
 * Every row binds a stored `filePath` to the `ownerId` (the user that uploaded
 * it) so that subsequent read/download/delete operations can enforce
 * `ownerId === context.user.id` for private files. Public files are recorded
 * too (so deletes can still be owner-gated) even though their reads are open.
 *
 * `ownerId` is stored as a string to match the string `UserInfo.id` carried on
 * the method context — no `ObjectId` conversion needed at the call sites.
 */
export const filesCollection = new Store('_modelenceFiles', {
  schema: {
    filePath: schema.string(),
    ownerId: schema.string(),
    visibility: schema.enum(['public', 'private']),
    contentType: schema.string(),
    createdAt: schema.date(),
  },
  indexes: [{ key: { filePath: 1 }, unique: true }, { key: { ownerId: 1 } }],
});
