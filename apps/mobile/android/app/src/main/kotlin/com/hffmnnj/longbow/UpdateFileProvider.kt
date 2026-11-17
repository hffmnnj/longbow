package com.hffmnnj.longbow

import androidx.core.content.FileProvider

/**
 * Shares downloaded update APKs with the system installer through a
 * temporary read grant. A subclass so its manifest entry does not collide with
 * other FileProviders that plugins declare.
 */
class UpdateFileProvider : FileProvider()
