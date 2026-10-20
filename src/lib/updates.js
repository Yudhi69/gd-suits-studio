/**
 * What an update is doing once the download is in, in the words shown under
 * its progress bar - or null while it is still downloading, when the bar
 * shows how much has arrived. Shared by Settings and the prompt as the app
 * opens, so the two never describe the same step differently.
 */
export function updatePhase(progress) {
  switch (progress?.phase) {
    case 'preparing': return 'Downloaded and checked - getting it ready...';
    case 'waiting': return 'Ready. Waiting for a render or an email that is still going to finish, then the app restarts...';
    case 'restarting': return 'Restarting on the new version...';
    default: return null;
  }
}

/**
 * What the window says as it opens after an update was handed over: the new
 * version is running, or it could not be put in place. Null when there is
 * nothing to say.
 */
export function settledMessage(settled) {
  if (settled?.outcome === 'installed') return { text: `Updated to version ${settled.current}`, kind: 'ok' };
  if (settled?.outcome === 'failed') {
    return {
      text: `Version ${settled.version} could not be put in place, so this is still version ${settled.current}. `
        + 'Settings > Updates has it as a download to install by hand.',
      kind: 'err',
    };
  }
  return null;
}
