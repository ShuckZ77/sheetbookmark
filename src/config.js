/**
 * Build-time configuration. Unlike a per-user secret, the OAuth *client ID* is meant to
 * ship inside the extension — it identifies the app to Google, not the user, and the
 * implicit flow carries no client secret. You (the publisher) create one OAuth client
 * once and paste its ID here; every user then just clicks "Connect". See README.
 *
 * Until this is filled in, the options page shows a "not configured yet" notice instead
 * of a dead Connect button.
 */
// The build replaces this placeholder with the real client id (scripts/build.mjs reads
// .keys/client-id.txt). The globalThis seam lets tests inject an id without a real build;
// it is undefined in production, so the baked value wins there.
const BAKED_CLIENT_ID = '__GOOGLE_OAUTH_CLIENT_ID__';
export const CLIENT_ID = globalThis.__BOOKMARK_CLIENT_ID__ ?? BAKED_CLIENT_ID;

export const isConfiguredBuild = () => /\.apps\.googleusercontent\.com$/.test(CLIENT_ID);

/**
 * drive.file is the light-verification scope: the app may only touch files it creates
 * or the user hands it, never the rest of the user's Drive. That is exactly the bookmark
 * sheet and nothing more, and it keeps the path to a public listing free of Google's
 * paid security assessment.
 */
export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

/**
 * The extension creates and then owns this spreadsheet in the user's Drive. The name is
 * only the starting point — reuse is keyed on the file id, so users can rename or move
 * it freely. Each install writes to its own tab, named after its profile label.
 */
export const SHEET_NAME = 'My SheetBookmark Collection';
