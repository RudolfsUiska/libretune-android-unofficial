import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { isAndroid } from './platform';

/**
 * Lets the user choose a folder and resolves to a path the backend can read,
 * or null if they cancelled.
 *
 * On Android the dialog plugin has no folder picker, and the system one yields
 * a content:// URI that the Rust side cannot open, so the backend copies the
 * chosen folder into app storage and returns that copy. Only top-level files
 * and the subfolders named in `includeDirs` are copied.
 */
export async function pickFolder(options: {
  title: string;
  includeDirs?: string[];
}): Promise<string | null> {
  if (isAndroid()) {
    return invoke<string | null>('pick_folder_copy', {
      includeDirs: options.includeDirs ?? [],
    });
  }
  const selected = await open({ directory: true, multiple: false, title: options.title });
  return typeof selected === 'string' ? selected : null;
}
