package com.libretune.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class PickFolderArgs {
  /** Top-level subfolders to copy (case-insensitive); other subfolders are skipped. */
  var includeDirs: Array<String> = emptyArray()
}

/**
 * Folder picker for Android.
 *
 * The system picker (Storage Access Framework) returns a content:// tree URI,
 * which Rust's std::fs cannot open. So the chosen folder is copied into the
 * app's cache and the copy's real path is returned. Only top-level files and
 * the named subfolders are copied: a TunerStudio project's DataLogs can run to
 * gigabytes and the importer never reads them.
 */
@TauriPlugin
class FolderPickerPlugin(private val activity: Activity) : Plugin(activity) {
  private var includeDirs: Set<String> = emptySet()

  @Command
  fun pickFolder(invoke: Invoke) {
    includeDirs = invoke.parseArgs(PickFolderArgs::class.java).includeDirs
      .map { it.lowercase() }.toSet()
    startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "folderPicked")
  }

  @ActivityCallback
  fun folderPicked(invoke: Invoke, result: ActivityResult) {
    val tree = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || tree == null) {
      invoke.resolve(JSObject()) // cancelled: no path
      return
    }
    // Copying can take a while on slow storage; keep it off the UI thread.
    Thread {
      try {
        val rootId = DocumentsContract.getTreeDocumentId(tree)
        val name = displayName(tree, rootId) ?: "picked-folder"
        val dest = File(File(activity.cacheDir, "picked-folders"), sanitize(name))
        dest.deleteRecursively()
        copyChildren(tree, rootId, dest, topLevel = true)
        val ret = JSObject()
        ret.put("path", dest.absolutePath)
        invoke.resolve(ret)
      } catch (e: Exception) {
        invoke.reject("Could not read the selected folder: ${e.message}")
      }
    }.start()
  }

  private fun copyChildren(tree: Uri, parentId: String, dest: File, topLevel: Boolean) {
    dest.mkdirs()
    val resolver = activity.contentResolver
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
    val columns = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE)
    resolver.query(childrenUri, columns, null, null, null)?.use { c ->
      while (c.moveToNext()) {
        val id = c.getString(0)
        val name = sanitize(c.getString(1) ?: continue)
        if (c.getString(2) == Document.MIME_TYPE_DIR) {
          if (!topLevel || name.lowercase() in includeDirs) {
            copyChildren(tree, id, File(dest, name), topLevel = false)
          }
        } else {
          resolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id))?.use { input ->
            File(dest, name).outputStream().use { input.copyTo(it) }
          }
        }
      }
    }
  }

  private fun displayName(tree: Uri, docId: String): String? =
    activity.contentResolver.query(
      DocumentsContract.buildDocumentUriUsingTree(tree, docId),
      arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null
    )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }

  // Document names come from another app's provider; never let one escape dest.
  private fun sanitize(name: String): String =
    name.replace('/', '_').replace('\\', '_').let { if (it == "." || it == "..") "_" else it }
}
