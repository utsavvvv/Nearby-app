// Small differences between the website and the Android app (Capacitor).

const cap = window.Capacitor;
export const isNative = Boolean(cap?.isNativePlatform?.());

/** Open a link outside the app (maps app, browser). */
export function openExternal(url) {
  if (isNative) {
    // Capacitor hands non-app URLs (https to other sites, geo:) to Android.
    window.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** Save a text file: download on the web, share sheet on Android. */
export async function saveTextFile(filename, text, mime = 'application/json') {
  const { Filesystem, Share } = cap?.Plugins || {};
  if (isNative && Filesystem && Share) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title: filename, files: [uri] });
    return;
  }
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
