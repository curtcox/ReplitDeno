// Copyright the Browserify authors. MIT License.
// Ported from https://github.com/browserify/path-browserify/
// This module is browser compatible.
import { CHAR_DOT, CHAR_FORWARD_SLASH } from "./_constants.ts";
import { _format, assertPath, encodeWhitespace, isPosixPathSeparator, normalizeString } from "./_util.ts";
export const sep = "/";
export const delimiter = ":";
// path.resolve([from ...], to)
/**
 * Resolves `pathSegments` into an absolute path.
 * @param pathSegments an array of path segments
 */ export function resolve(...pathSegments) {
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for(let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--){
    let path;
    if (i >= 0) path = pathSegments[i];
    else {
      if (globalThis.Deno == null) {
        throw new TypeError("Resolved a relative path without a CWD.");
      }
      path = Deno.cwd();
    }
    assertPath(path);
    // Skip empty entries
    if (path.length === 0) {
      continue;
    }
    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  }
  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)
  // Normalize the path
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
  if (resolvedAbsolute) {
    if (resolvedPath.length > 0) return `/${resolvedPath}`;
    else return "/";
  } else if (resolvedPath.length > 0) return resolvedPath;
  else return ".";
}
/**
 * Normalize the `path`, resolving `'..'` and `'.'` segments.
 * @param path to be normalized
 */ export function normalize(path) {
  assertPath(path);
  if (path.length === 0) return ".";
  const isAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  const trailingSeparator = path.charCodeAt(path.length - 1) === CHAR_FORWARD_SLASH;
  // Normalize the path
  path = normalizeString(path, !isAbsolute, "/", isPosixPathSeparator);
  if (path.length === 0 && !isAbsolute) path = ".";
  if (path.length > 0 && trailingSeparator) path += "/";
  if (isAbsolute) return `/${path}`;
  return path;
}
/**
 * Verifies whether provided path is absolute
 * @param path to be verified as absolute
 */ export function isAbsolute(path) {
  assertPath(path);
  return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH;
}
/**
 * Join all given a sequence of `paths`,then normalizes the resulting path.
 * @param paths to be joined and normalized
 */ export function join(...paths) {
  if (paths.length === 0) return ".";
  let joined;
  for(let i = 0, len = paths.length; i < len; ++i){
    const path = paths[i];
    assertPath(path);
    if (path.length > 0) {
      if (!joined) joined = path;
      else joined += `/${path}`;
    }
  }
  if (!joined) return ".";
  return normalize(joined);
}
/**
 * Return the relative path from `from` to `to` based on current working directory.
 * @param from path in current working directory
 * @param to path in current working directory
 */ export function relative(from, to) {
  assertPath(from);
  assertPath(to);
  if (from === to) return "";
  from = resolve(from);
  to = resolve(to);
  if (from === to) return "";
  // Trim any leading backslashes
  let fromStart = 1;
  const fromEnd = from.length;
  for(; fromStart < fromEnd; ++fromStart){
    if (from.charCodeAt(fromStart) !== CHAR_FORWARD_SLASH) break;
  }
  const fromLen = fromEnd - fromStart;
  // Trim any leading backslashes
  let toStart = 1;
  const toEnd = to.length;
  for(; toStart < toEnd; ++toStart){
    if (to.charCodeAt(toStart) !== CHAR_FORWARD_SLASH) break;
  }
  const toLen = toEnd - toStart;
  // Compare paths to find the longest common path from root
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for(; i <= length; ++i){
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === CHAR_FORWARD_SLASH) {
          // We get here if `from` is the exact base path for `to`.
          // For example: from='/foo/bar'; to='/foo/bar/baz'
          return to.slice(toStart + i + 1);
        } else if (i === 0) {
          // We get here if `from` is the root
          // For example: from='/'; to='/foo'
          return to.slice(toStart + i);
        }
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === CHAR_FORWARD_SLASH) {
          // We get here if `to` is the exact base path for `from`.
          // For example: from='/foo/bar/baz'; to='/foo/bar'
          lastCommonSep = i;
        } else if (i === 0) {
          // We get here if `to` is the root.
          // For example: from='/foo'; to='/'
          lastCommonSep = 0;
        }
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    else if (fromCode === CHAR_FORWARD_SLASH) lastCommonSep = i;
  }
  let out = "";
  // Generate the relative path based on the path difference between `to`
  // and `from`
  for(i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i){
    if (i === fromEnd || from.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (out.length === 0) out += "..";
      else out += "/..";
    }
  }
  // Lastly, append the rest of the destination (`to`) path that comes after
  // the common path parts
  if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
  else {
    toStart += lastCommonSep;
    if (to.charCodeAt(toStart) === CHAR_FORWARD_SLASH) ++toStart;
    return to.slice(toStart);
  }
}
/**
 * Resolves path to a namespace path
 * @param path to resolve to namespace
 */ export function toNamespacedPath(path) {
  // Non-op on posix systems
  return path;
}
/**
 * Return the directory name of a `path`.
 * @param path to determine name for
 */ export function dirname(path) {
  assertPath(path);
  if (path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  let end = -1;
  let matchedSlash = true;
  for(let i = path.length - 1; i >= 1; --i){
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      // We saw the first non-path separator
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}
/**
 * Return the last portion of a `path`. Trailing directory separators are ignored.
 * @param path to process
 * @param ext of path directory
 */ export function basename(path, ext = "") {
  if (ext !== undefined && typeof ext !== "string") {
    throw new TypeError('"ext" argument must be a string');
  }
  assertPath(path);
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  let i;
  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path) return "";
    let extIdx = ext.length - 1;
    let firstNonSlashEnd = -1;
    for(i = path.length - 1; i >= 0; --i){
      const code = path.charCodeAt(i);
      if (code === CHAR_FORWARD_SLASH) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          // We saw the first non-path separator, remember this index in case
          // we need it if the extension ends up not matching
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          // Try to match the explicit extension
          if (code === ext.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              // We matched the extension, so mark this as the end of our path
              // component
              end = i;
            }
          } else {
            // Extension does not match, so our result is the entire path
            // component
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }
    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  } else {
    for(i = path.length - 1; i >= 0; --i){
      if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // path component
        matchedSlash = false;
        end = i + 1;
      }
    }
    if (end === -1) return "";
    return path.slice(start, end);
  }
}
/**
 * Return the extension of the `path`.
 * @param path with extension
 */ export function extname(path) {
  assertPath(path);
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  let preDotState = 0;
  for(let i = path.length - 1; i >= 0; --i){
    const code = path.charCodeAt(i);
    if (code === CHAR_FORWARD_SLASH) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
  preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
  preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return "";
  }
  return path.slice(startDot, end);
}
/**
 * Generate a path from `FormatInputPathObject` object.
 * @param pathObject with path
 */ export function format(pathObject) {
  if (pathObject === null || typeof pathObject !== "object") {
    throw new TypeError(`The "pathObject" argument must be of type Object. Received type ${typeof pathObject}`);
  }
  return _format("/", pathObject);
}
/**
 * Return a `ParsedPath` object of the `path`.
 * @param path to process
 */ export function parse(path) {
  assertPath(path);
  const ret = {
    root: "",
    dir: "",
    base: "",
    ext: "",
    name: ""
  };
  if (path.length === 0) return ret;
  const isAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  let start;
  if (isAbsolute) {
    ret.root = "/";
    start = 1;
  } else {
    start = 0;
  }
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let i = path.length - 1;
  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  let preDotState = 0;
  // Get non-dir info
  for(; i >= start; --i){
    const code = path.charCodeAt(i);
    if (code === CHAR_FORWARD_SLASH) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
  preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
  preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    if (end !== -1) {
      if (startPart === 0 && isAbsolute) {
        ret.base = ret.name = path.slice(1, end);
      } else {
        ret.base = ret.name = path.slice(startPart, end);
      }
    }
  } else {
    if (startPart === 0 && isAbsolute) {
      ret.name = path.slice(1, startDot);
      ret.base = path.slice(1, end);
    } else {
      ret.name = path.slice(startPart, startDot);
      ret.base = path.slice(startPart, end);
    }
    ret.ext = path.slice(startDot, end);
  }
  if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
  else if (isAbsolute) ret.dir = "/";
  return ret;
}
/**
 * Converts a file URL to a path string.
 *
 *      fromFileUrl("file:///home/foo"); // "/home/foo"
 * @param url of a file URL
 */ export function fromFileUrl(url) {
  url = url instanceof URL ? url : new URL(url);
  if (url.protocol != "file:") {
    throw new TypeError("Must be a file URL.");
  }
  return decodeURIComponent(url.pathname.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
}
/**
 * Converts a path string to a file URL.
 *
 *      toFileUrl("/home/foo"); // new URL("file:///home/foo")
 * @param path to convert to file URL
 */ export function toFileUrl(path) {
  if (!isAbsolute(path)) {
    throw new TypeError("Must be an absolute path.");
  }
  const url = new URL("file:///");
  url.pathname = encodeWhitespace(path.replace(/%/g, "%25").replace(/\\/g, "%5C"));
  return url;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAwLjkyLjAvcGF0aC9wb3NpeC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgdGhlIEJyb3dzZXJpZnkgYXV0aG9ycy4gTUlUIExpY2Vuc2UuXG4vLyBQb3J0ZWQgZnJvbSBodHRwczovL2dpdGh1Yi5jb20vYnJvd3NlcmlmeS9wYXRoLWJyb3dzZXJpZnkvXG4vLyBUaGlzIG1vZHVsZSBpcyBicm93c2VyIGNvbXBhdGlibGUuXG5cbmltcG9ydCB0eXBlIHsgRm9ybWF0SW5wdXRQYXRoT2JqZWN0LCBQYXJzZWRQYXRoIH0gZnJvbSBcIi4vX2ludGVyZmFjZS50c1wiO1xuaW1wb3J0IHsgQ0hBUl9ET1QsIENIQVJfRk9SV0FSRF9TTEFTSCB9IGZyb20gXCIuL19jb25zdGFudHMudHNcIjtcblxuaW1wb3J0IHtcbiAgX2Zvcm1hdCxcbiAgYXNzZXJ0UGF0aCxcbiAgZW5jb2RlV2hpdGVzcGFjZSxcbiAgaXNQb3NpeFBhdGhTZXBhcmF0b3IsXG4gIG5vcm1hbGl6ZVN0cmluZyxcbn0gZnJvbSBcIi4vX3V0aWwudHNcIjtcblxuZXhwb3J0IGNvbnN0IHNlcCA9IFwiL1wiO1xuZXhwb3J0IGNvbnN0IGRlbGltaXRlciA9IFwiOlwiO1xuXG4vLyBwYXRoLnJlc29sdmUoW2Zyb20gLi4uXSwgdG8pXG4vKipcbiAqIFJlc29sdmVzIGBwYXRoU2VnbWVudHNgIGludG8gYW4gYWJzb2x1dGUgcGF0aC5cbiAqIEBwYXJhbSBwYXRoU2VnbWVudHMgYW4gYXJyYXkgb2YgcGF0aCBzZWdtZW50c1xuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZSguLi5wYXRoU2VnbWVudHM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgbGV0IHJlc29sdmVkUGF0aCA9IFwiXCI7XG4gIGxldCByZXNvbHZlZEFic29sdXRlID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IHBhdGhTZWdtZW50cy5sZW5ndGggLSAxOyBpID49IC0xICYmICFyZXNvbHZlZEFic29sdXRlOyBpLS0pIHtcbiAgICBsZXQgcGF0aDogc3RyaW5nO1xuXG4gICAgaWYgKGkgPj0gMCkgcGF0aCA9IHBhdGhTZWdtZW50c1tpXTtcbiAgICBlbHNlIHtcbiAgICAgIGlmIChnbG9iYWxUaGlzLkRlbm8gPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUmVzb2x2ZWQgYSByZWxhdGl2ZSBwYXRoIHdpdGhvdXQgYSBDV0QuXCIpO1xuICAgICAgfVxuICAgICAgcGF0aCA9IERlbm8uY3dkKCk7XG4gICAgfVxuXG4gICAgYXNzZXJ0UGF0aChwYXRoKTtcblxuICAgIC8vIFNraXAgZW1wdHkgZW50cmllc1xuICAgIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgcmVzb2x2ZWRQYXRoID0gYCR7cGF0aH0vJHtyZXNvbHZlZFBhdGh9YDtcbiAgICByZXNvbHZlZEFic29sdXRlID0gcGF0aC5jaGFyQ29kZUF0KDApID09PSBDSEFSX0ZPUldBUkRfU0xBU0g7XG4gIH1cblxuICAvLyBBdCB0aGlzIHBvaW50IHRoZSBwYXRoIHNob3VsZCBiZSByZXNvbHZlZCB0byBhIGZ1bGwgYWJzb2x1dGUgcGF0aCwgYnV0XG4gIC8vIGhhbmRsZSByZWxhdGl2ZSBwYXRocyB0byBiZSBzYWZlIChtaWdodCBoYXBwZW4gd2hlbiBwcm9jZXNzLmN3ZCgpIGZhaWxzKVxuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxuICByZXNvbHZlZFBhdGggPSBub3JtYWxpemVTdHJpbmcoXG4gICAgcmVzb2x2ZWRQYXRoLFxuICAgICFyZXNvbHZlZEFic29sdXRlLFxuICAgIFwiL1wiLFxuICAgIGlzUG9zaXhQYXRoU2VwYXJhdG9yLFxuICApO1xuXG4gIGlmIChyZXNvbHZlZEFic29sdXRlKSB7XG4gICAgaWYgKHJlc29sdmVkUGF0aC5sZW5ndGggPiAwKSByZXR1cm4gYC8ke3Jlc29sdmVkUGF0aH1gO1xuICAgIGVsc2UgcmV0dXJuIFwiL1wiO1xuICB9IGVsc2UgaWYgKHJlc29sdmVkUGF0aC5sZW5ndGggPiAwKSByZXR1cm4gcmVzb2x2ZWRQYXRoO1xuICBlbHNlIHJldHVybiBcIi5cIjtcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgdGhlIGBwYXRoYCwgcmVzb2x2aW5nIGAnLi4nYCBhbmQgYCcuJ2Agc2VnbWVudHMuXG4gKiBAcGFyYW0gcGF0aCB0byBiZSBub3JtYWxpemVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemUocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgYXNzZXJ0UGF0aChwYXRoKTtcblxuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBcIi5cIjtcblxuICBjb25zdCBpc0Fic29sdXRlID0gcGF0aC5jaGFyQ29kZUF0KDApID09PSBDSEFSX0ZPUldBUkRfU0xBU0g7XG4gIGNvbnN0IHRyYWlsaW5nU2VwYXJhdG9yID1cbiAgICBwYXRoLmNoYXJDb2RlQXQocGF0aC5sZW5ndGggLSAxKSA9PT0gQ0hBUl9GT1JXQVJEX1NMQVNIO1xuXG4gIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxuICBwYXRoID0gbm9ybWFsaXplU3RyaW5nKHBhdGgsICFpc0Fic29sdXRlLCBcIi9cIiwgaXNQb3NpeFBhdGhTZXBhcmF0b3IpO1xuXG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCAmJiAhaXNBYnNvbHV0ZSkgcGF0aCA9IFwiLlwiO1xuICBpZiAocGF0aC5sZW5ndGggPiAwICYmIHRyYWlsaW5nU2VwYXJhdG9yKSBwYXRoICs9IFwiL1wiO1xuXG4gIGlmIChpc0Fic29sdXRlKSByZXR1cm4gYC8ke3BhdGh9YDtcbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8qKlxuICogVmVyaWZpZXMgd2hldGhlciBwcm92aWRlZCBwYXRoIGlzIGFic29sdXRlXG4gKiBAcGFyYW0gcGF0aCB0byBiZSB2ZXJpZmllZCBhcyBhYnNvbHV0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBYnNvbHV0ZShwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgYXNzZXJ0UGF0aChwYXRoKTtcbiAgcmV0dXJuIHBhdGgubGVuZ3RoID4gMCAmJiBwYXRoLmNoYXJDb2RlQXQoMCkgPT09IENIQVJfRk9SV0FSRF9TTEFTSDtcbn1cblxuLyoqXG4gKiBKb2luIGFsbCBnaXZlbiBhIHNlcXVlbmNlIG9mIGBwYXRoc2AsdGhlbiBub3JtYWxpemVzIHRoZSByZXN1bHRpbmcgcGF0aC5cbiAqIEBwYXJhbSBwYXRocyB0byBiZSBqb2luZWQgYW5kIG5vcm1hbGl6ZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGpvaW4oLi4ucGF0aHM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiLlwiO1xuICBsZXQgam9pbmVkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIGZvciAobGV0IGkgPSAwLCBsZW4gPSBwYXRocy5sZW5ndGg7IGkgPCBsZW47ICsraSkge1xuICAgIGNvbnN0IHBhdGggPSBwYXRoc1tpXTtcbiAgICBhc3NlcnRQYXRoKHBhdGgpO1xuICAgIGlmIChwYXRoLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmICgham9pbmVkKSBqb2luZWQgPSBwYXRoO1xuICAgICAgZWxzZSBqb2luZWQgKz0gYC8ke3BhdGh9YDtcbiAgICB9XG4gIH1cbiAgaWYgKCFqb2luZWQpIHJldHVybiBcIi5cIjtcbiAgcmV0dXJuIG5vcm1hbGl6ZShqb2luZWQpO1xufVxuXG4vKipcbiAqIFJldHVybiB0aGUgcmVsYXRpdmUgcGF0aCBmcm9tIGBmcm9tYCB0byBgdG9gIGJhc2VkIG9uIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuXG4gKiBAcGFyYW0gZnJvbSBwYXRoIGluIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnlcbiAqIEBwYXJhbSB0byBwYXRoIGluIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlKGZyb206IHN0cmluZywgdG86IHN0cmluZyk6IHN0cmluZyB7XG4gIGFzc2VydFBhdGgoZnJvbSk7XG4gIGFzc2VydFBhdGgodG8pO1xuXG4gIGlmIChmcm9tID09PSB0bykgcmV0dXJuIFwiXCI7XG5cbiAgZnJvbSA9IHJlc29sdmUoZnJvbSk7XG4gIHRvID0gcmVzb2x2ZSh0byk7XG5cbiAgaWYgKGZyb20gPT09IHRvKSByZXR1cm4gXCJcIjtcblxuICAvLyBUcmltIGFueSBsZWFkaW5nIGJhY2tzbGFzaGVzXG4gIGxldCBmcm9tU3RhcnQgPSAxO1xuICBjb25zdCBmcm9tRW5kID0gZnJvbS5sZW5ndGg7XG4gIGZvciAoOyBmcm9tU3RhcnQgPCBmcm9tRW5kOyArK2Zyb21TdGFydCkge1xuICAgIGlmIChmcm9tLmNoYXJDb2RlQXQoZnJvbVN0YXJ0KSAhPT0gQ0hBUl9GT1JXQVJEX1NMQVNIKSBicmVhaztcbiAgfVxuICBjb25zdCBmcm9tTGVuID0gZnJvbUVuZCAtIGZyb21TdGFydDtcblxuICAvLyBUcmltIGFueSBsZWFkaW5nIGJhY2tzbGFzaGVzXG4gIGxldCB0b1N0YXJ0ID0gMTtcbiAgY29uc3QgdG9FbmQgPSB0by5sZW5ndGg7XG4gIGZvciAoOyB0b1N0YXJ0IDwgdG9FbmQ7ICsrdG9TdGFydCkge1xuICAgIGlmICh0by5jaGFyQ29kZUF0KHRvU3RhcnQpICE9PSBDSEFSX0ZPUldBUkRfU0xBU0gpIGJyZWFrO1xuICB9XG4gIGNvbnN0IHRvTGVuID0gdG9FbmQgLSB0b1N0YXJ0O1xuXG4gIC8vIENvbXBhcmUgcGF0aHMgdG8gZmluZCB0aGUgbG9uZ2VzdCBjb21tb24gcGF0aCBmcm9tIHJvb3RcbiAgY29uc3QgbGVuZ3RoID0gZnJvbUxlbiA8IHRvTGVuID8gZnJvbUxlbiA6IHRvTGVuO1xuICBsZXQgbGFzdENvbW1vblNlcCA9IC0xO1xuICBsZXQgaSA9IDA7XG4gIGZvciAoOyBpIDw9IGxlbmd0aDsgKytpKSB7XG4gICAgaWYgKGkgPT09IGxlbmd0aCkge1xuICAgICAgaWYgKHRvTGVuID4gbGVuZ3RoKSB7XG4gICAgICAgIGlmICh0by5jaGFyQ29kZUF0KHRvU3RhcnQgKyBpKSA9PT0gQ0hBUl9GT1JXQVJEX1NMQVNIKSB7XG4gICAgICAgICAgLy8gV2UgZ2V0IGhlcmUgaWYgYGZyb21gIGlzIHRoZSBleGFjdCBiYXNlIHBhdGggZm9yIGB0b2AuXG4gICAgICAgICAgLy8gRm9yIGV4YW1wbGU6IGZyb209Jy9mb28vYmFyJzsgdG89Jy9mb28vYmFyL2JheidcbiAgICAgICAgICByZXR1cm4gdG8uc2xpY2UodG9TdGFydCArIGkgKyAxKTtcbiAgICAgICAgfSBlbHNlIGlmIChpID09PSAwKSB7XG4gICAgICAgICAgLy8gV2UgZ2V0IGhlcmUgaWYgYGZyb21gIGlzIHRoZSByb290XG4gICAgICAgICAgLy8gRm9yIGV4YW1wbGU6IGZyb209Jy8nOyB0bz0nL2ZvbydcbiAgICAgICAgICByZXR1cm4gdG8uc2xpY2UodG9TdGFydCArIGkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGZyb21MZW4gPiBsZW5ndGgpIHtcbiAgICAgICAgaWYgKGZyb20uY2hhckNvZGVBdChmcm9tU3RhcnQgKyBpKSA9PT0gQ0hBUl9GT1JXQVJEX1NMQVNIKSB7XG4gICAgICAgICAgLy8gV2UgZ2V0IGhlcmUgaWYgYHRvYCBpcyB0aGUgZXhhY3QgYmFzZSBwYXRoIGZvciBgZnJvbWAuXG4gICAgICAgICAgLy8gRm9yIGV4YW1wbGU6IGZyb209Jy9mb28vYmFyL2Jheic7IHRvPScvZm9vL2JhcidcbiAgICAgICAgICBsYXN0Q29tbW9uU2VwID0gaTtcbiAgICAgICAgfSBlbHNlIGlmIChpID09PSAwKSB7XG4gICAgICAgICAgLy8gV2UgZ2V0IGhlcmUgaWYgYHRvYCBpcyB0aGUgcm9vdC5cbiAgICAgICAgICAvLyBGb3IgZXhhbXBsZTogZnJvbT0nL2Zvbyc7IHRvPScvJ1xuICAgICAgICAgIGxhc3RDb21tb25TZXAgPSAwO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY29uc3QgZnJvbUNvZGUgPSBmcm9tLmNoYXJDb2RlQXQoZnJvbVN0YXJ0ICsgaSk7XG4gICAgY29uc3QgdG9Db2RlID0gdG8uY2hhckNvZGVBdCh0b1N0YXJ0ICsgaSk7XG4gICAgaWYgKGZyb21Db2RlICE9PSB0b0NvZGUpIGJyZWFrO1xuICAgIGVsc2UgaWYgKGZyb21Db2RlID09PSBDSEFSX0ZPUldBUkRfU0xBU0gpIGxhc3RDb21tb25TZXAgPSBpO1xuICB9XG5cbiAgbGV0IG91dCA9IFwiXCI7XG4gIC8vIEdlbmVyYXRlIHRoZSByZWxhdGl2ZSBwYXRoIGJhc2VkIG9uIHRoZSBwYXRoIGRpZmZlcmVuY2UgYmV0d2VlbiBgdG9gXG4gIC8vIGFuZCBgZnJvbWBcbiAgZm9yIChpID0gZnJvbVN0YXJ0ICsgbGFzdENvbW1vblNlcCArIDE7IGkgPD0gZnJvbUVuZDsgKytpKSB7XG4gICAgaWYgKGkgPT09IGZyb21FbmQgfHwgZnJvbS5jaGFyQ29kZUF0KGkpID09PSBDSEFSX0ZPUldBUkRfU0xBU0gpIHtcbiAgICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSBvdXQgKz0gXCIuLlwiO1xuICAgICAgZWxzZSBvdXQgKz0gXCIvLi5cIjtcbiAgICB9XG4gIH1cblxuICAvLyBMYXN0bHksIGFwcGVuZCB0aGUgcmVzdCBvZiB0aGUgZGVzdGluYXRpb24gKGB0b2ApIHBhdGggdGhhdCBjb21lcyBhZnRlclxuICAvLyB0aGUgY29tbW9uIHBhdGggcGFydHNcbiAgaWYgKG91dC5sZW5ndGggPiAwKSByZXR1cm4gb3V0ICsgdG8uc2xpY2UodG9TdGFydCArIGxhc3RDb21tb25TZXApO1xuICBlbHNlIHtcbiAgICB0b1N0YXJ0ICs9IGxhc3RDb21tb25TZXA7XG4gICAgaWYgKHRvLmNoYXJDb2RlQXQodG9TdGFydCkgPT09IENIQVJfRk9SV0FSRF9TTEFTSCkgKyt0b1N0YXJ0O1xuICAgIHJldHVybiB0by5zbGljZSh0b1N0YXJ0KTtcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHBhdGggdG8gYSBuYW1lc3BhY2UgcGF0aFxuICogQHBhcmFtIHBhdGggdG8gcmVzb2x2ZSB0byBuYW1lc3BhY2VcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvTmFtZXNwYWNlZFBhdGgocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gTm9uLW9wIG9uIHBvc2l4IHN5c3RlbXNcbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8qKlxuICogUmV0dXJuIHRoZSBkaXJlY3RvcnkgbmFtZSBvZiBhIGBwYXRoYC5cbiAqIEBwYXJhbSBwYXRoIHRvIGRldGVybWluZSBuYW1lIGZvclxuICovXG5leHBvcnQgZnVuY3Rpb24gZGlybmFtZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBhc3NlcnRQYXRoKHBhdGgpO1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBcIi5cIjtcbiAgY29uc3QgaGFzUm9vdCA9IHBhdGguY2hhckNvZGVBdCgwKSA9PT0gQ0hBUl9GT1JXQVJEX1NMQVNIO1xuICBsZXQgZW5kID0gLTE7XG4gIGxldCBtYXRjaGVkU2xhc2ggPSB0cnVlO1xuICBmb3IgKGxldCBpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDE7IC0taSkge1xuICAgIGlmIChwYXRoLmNoYXJDb2RlQXQoaSkgPT09IENIQVJfRk9SV0FSRF9TTEFTSCkge1xuICAgICAgaWYgKCFtYXRjaGVkU2xhc2gpIHtcbiAgICAgICAgZW5kID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdlIHNhdyB0aGUgZmlyc3Qgbm9uLXBhdGggc2VwYXJhdG9yXG4gICAgICBtYXRjaGVkU2xhc2ggPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIGhhc1Jvb3QgPyBcIi9cIiA6IFwiLlwiO1xuICBpZiAoaGFzUm9vdCAmJiBlbmQgPT09IDEpIHJldHVybiBcIi8vXCI7XG4gIHJldHVybiBwYXRoLnNsaWNlKDAsIGVuZCk7XG59XG5cbi8qKlxuICogUmV0dXJuIHRoZSBsYXN0IHBvcnRpb24gb2YgYSBgcGF0aGAuIFRyYWlsaW5nIGRpcmVjdG9yeSBzZXBhcmF0b3JzIGFyZSBpZ25vcmVkLlxuICogQHBhcmFtIHBhdGggdG8gcHJvY2Vzc1xuICogQHBhcmFtIGV4dCBvZiBwYXRoIGRpcmVjdG9yeVxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZW5hbWUocGF0aDogc3RyaW5nLCBleHQgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKGV4dCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBleHQgIT09IFwic3RyaW5nXCIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcImV4dFwiIGFyZ3VtZW50IG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgfVxuICBhc3NlcnRQYXRoKHBhdGgpO1xuXG4gIGxldCBzdGFydCA9IDA7XG4gIGxldCBlbmQgPSAtMTtcbiAgbGV0IG1hdGNoZWRTbGFzaCA9IHRydWU7XG4gIGxldCBpOiBudW1iZXI7XG5cbiAgaWYgKGV4dCAhPT0gdW5kZWZpbmVkICYmIGV4dC5sZW5ndGggPiAwICYmIGV4dC5sZW5ndGggPD0gcGF0aC5sZW5ndGgpIHtcbiAgICBpZiAoZXh0Lmxlbmd0aCA9PT0gcGF0aC5sZW5ndGggJiYgZXh0ID09PSBwYXRoKSByZXR1cm4gXCJcIjtcbiAgICBsZXQgZXh0SWR4ID0gZXh0Lmxlbmd0aCAtIDE7XG4gICAgbGV0IGZpcnN0Tm9uU2xhc2hFbmQgPSAtMTtcbiAgICBmb3IgKGkgPSBwYXRoLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgICBjb25zdCBjb2RlID0gcGF0aC5jaGFyQ29kZUF0KGkpO1xuICAgICAgaWYgKGNvZGUgPT09IENIQVJfRk9SV0FSRF9TTEFTSCkge1xuICAgICAgICAvLyBJZiB3ZSByZWFjaGVkIGEgcGF0aCBzZXBhcmF0b3IgdGhhdCB3YXMgbm90IHBhcnQgb2YgYSBzZXQgb2YgcGF0aFxuICAgICAgICAvLyBzZXBhcmF0b3JzIGF0IHRoZSBlbmQgb2YgdGhlIHN0cmluZywgc3RvcCBub3dcbiAgICAgICAgaWYgKCFtYXRjaGVkU2xhc2gpIHtcbiAgICAgICAgICBzdGFydCA9IGkgKyAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoZmlyc3ROb25TbGFzaEVuZCA9PT0gLTEpIHtcbiAgICAgICAgICAvLyBXZSBzYXcgdGhlIGZpcnN0IG5vbi1wYXRoIHNlcGFyYXRvciwgcmVtZW1iZXIgdGhpcyBpbmRleCBpbiBjYXNlXG4gICAgICAgICAgLy8gd2UgbmVlZCBpdCBpZiB0aGUgZXh0ZW5zaW9uIGVuZHMgdXAgbm90IG1hdGNoaW5nXG4gICAgICAgICAgbWF0Y2hlZFNsYXNoID0gZmFsc2U7XG4gICAgICAgICAgZmlyc3ROb25TbGFzaEVuZCA9IGkgKyAxO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHRJZHggPj0gMCkge1xuICAgICAgICAgIC8vIFRyeSB0byBtYXRjaCB0aGUgZXhwbGljaXQgZXh0ZW5zaW9uXG4gICAgICAgICAgaWYgKGNvZGUgPT09IGV4dC5jaGFyQ29kZUF0KGV4dElkeCkpIHtcbiAgICAgICAgICAgIGlmICgtLWV4dElkeCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgLy8gV2UgbWF0Y2hlZCB0aGUgZXh0ZW5zaW9uLCBzbyBtYXJrIHRoaXMgYXMgdGhlIGVuZCBvZiBvdXIgcGF0aFxuICAgICAgICAgICAgICAvLyBjb21wb25lbnRcbiAgICAgICAgICAgICAgZW5kID0gaTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRXh0ZW5zaW9uIGRvZXMgbm90IG1hdGNoLCBzbyBvdXIgcmVzdWx0IGlzIHRoZSBlbnRpcmUgcGF0aFxuICAgICAgICAgICAgLy8gY29tcG9uZW50XG4gICAgICAgICAgICBleHRJZHggPSAtMTtcbiAgICAgICAgICAgIGVuZCA9IGZpcnN0Tm9uU2xhc2hFbmQ7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHN0YXJ0ID09PSBlbmQpIGVuZCA9IGZpcnN0Tm9uU2xhc2hFbmQ7XG4gICAgZWxzZSBpZiAoZW5kID09PSAtMSkgZW5kID0gcGF0aC5sZW5ndGg7XG4gICAgcmV0dXJuIHBhdGguc2xpY2Uoc3RhcnQsIGVuZCk7XG4gIH0gZWxzZSB7XG4gICAgZm9yIChpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgICAgaWYgKHBhdGguY2hhckNvZGVBdChpKSA9PT0gQ0hBUl9GT1JXQVJEX1NMQVNIKSB7XG4gICAgICAgIC8vIElmIHdlIHJlYWNoZWQgYSBwYXRoIHNlcGFyYXRvciB0aGF0IHdhcyBub3QgcGFydCBvZiBhIHNldCBvZiBwYXRoXG4gICAgICAgIC8vIHNlcGFyYXRvcnMgYXQgdGhlIGVuZCBvZiB0aGUgc3RyaW5nLCBzdG9wIG5vd1xuICAgICAgICBpZiAoIW1hdGNoZWRTbGFzaCkge1xuICAgICAgICAgIHN0YXJ0ID0gaSArIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZW5kID09PSAtMSkge1xuICAgICAgICAvLyBXZSBzYXcgdGhlIGZpcnN0IG5vbi1wYXRoIHNlcGFyYXRvciwgbWFyayB0aGlzIGFzIHRoZSBlbmQgb2Ygb3VyXG4gICAgICAgIC8vIHBhdGggY29tcG9uZW50XG4gICAgICAgIG1hdGNoZWRTbGFzaCA9IGZhbHNlO1xuICAgICAgICBlbmQgPSBpICsgMTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIFwiXCI7XG4gICAgcmV0dXJuIHBhdGguc2xpY2Uoc3RhcnQsIGVuZCk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm4gdGhlIGV4dGVuc2lvbiBvZiB0aGUgYHBhdGhgLlxuICogQHBhcmFtIHBhdGggd2l0aCBleHRlbnNpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dG5hbWUocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgYXNzZXJ0UGF0aChwYXRoKTtcbiAgbGV0IHN0YXJ0RG90ID0gLTE7XG4gIGxldCBzdGFydFBhcnQgPSAwO1xuICBsZXQgZW5kID0gLTE7XG4gIGxldCBtYXRjaGVkU2xhc2ggPSB0cnVlO1xuICAvLyBUcmFjayB0aGUgc3RhdGUgb2YgY2hhcmFjdGVycyAoaWYgYW55KSB3ZSBzZWUgYmVmb3JlIG91ciBmaXJzdCBkb3QgYW5kXG4gIC8vIGFmdGVyIGFueSBwYXRoIHNlcGFyYXRvciB3ZSBmaW5kXG4gIGxldCBwcmVEb3RTdGF0ZSA9IDA7XG4gIGZvciAobGV0IGkgPSBwYXRoLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgY29uc3QgY29kZSA9IHBhdGguY2hhckNvZGVBdChpKTtcbiAgICBpZiAoY29kZSA9PT0gQ0hBUl9GT1JXQVJEX1NMQVNIKSB7XG4gICAgICAvLyBJZiB3ZSByZWFjaGVkIGEgcGF0aCBzZXBhcmF0b3IgdGhhdCB3YXMgbm90IHBhcnQgb2YgYSBzZXQgb2YgcGF0aFxuICAgICAgLy8gc2VwYXJhdG9ycyBhdCB0aGUgZW5kIG9mIHRoZSBzdHJpbmcsIHN0b3Agbm93XG4gICAgICBpZiAoIW1hdGNoZWRTbGFzaCkge1xuICAgICAgICBzdGFydFBhcnQgPSBpICsgMTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGVuZCA9PT0gLTEpIHtcbiAgICAgIC8vIFdlIHNhdyB0aGUgZmlyc3Qgbm9uLXBhdGggc2VwYXJhdG9yLCBtYXJrIHRoaXMgYXMgdGhlIGVuZCBvZiBvdXJcbiAgICAgIC8vIGV4dGVuc2lvblxuICAgICAgbWF0Y2hlZFNsYXNoID0gZmFsc2U7XG4gICAgICBlbmQgPSBpICsgMTtcbiAgICB9XG4gICAgaWYgKGNvZGUgPT09IENIQVJfRE9UKSB7XG4gICAgICAvLyBJZiB0aGlzIGlzIG91ciBmaXJzdCBkb3QsIG1hcmsgaXQgYXMgdGhlIHN0YXJ0IG9mIG91ciBleHRlbnNpb25cbiAgICAgIGlmIChzdGFydERvdCA9PT0gLTEpIHN0YXJ0RG90ID0gaTtcbiAgICAgIGVsc2UgaWYgKHByZURvdFN0YXRlICE9PSAxKSBwcmVEb3RTdGF0ZSA9IDE7XG4gICAgfSBlbHNlIGlmIChzdGFydERvdCAhPT0gLTEpIHtcbiAgICAgIC8vIFdlIHNhdyBhIG5vbi1kb3QgYW5kIG5vbi1wYXRoIHNlcGFyYXRvciBiZWZvcmUgb3VyIGRvdCwgc28gd2Ugc2hvdWxkXG4gICAgICAvLyBoYXZlIGEgZ29vZCBjaGFuY2UgYXQgaGF2aW5nIGEgbm9uLWVtcHR5IGV4dGVuc2lvblxuICAgICAgcHJlRG90U3RhdGUgPSAtMTtcbiAgICB9XG4gIH1cblxuICBpZiAoXG4gICAgc3RhcnREb3QgPT09IC0xIHx8XG4gICAgZW5kID09PSAtMSB8fFxuICAgIC8vIFdlIHNhdyBhIG5vbi1kb3QgY2hhcmFjdGVyIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGUgZG90XG4gICAgcHJlRG90U3RhdGUgPT09IDAgfHxcbiAgICAvLyBUaGUgKHJpZ2h0LW1vc3QpIHRyaW1tZWQgcGF0aCBjb21wb25lbnQgaXMgZXhhY3RseSAnLi4nXG4gICAgKHByZURvdFN0YXRlID09PSAxICYmIHN0YXJ0RG90ID09PSBlbmQgLSAxICYmIHN0YXJ0RG90ID09PSBzdGFydFBhcnQgKyAxKVxuICApIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuICByZXR1cm4gcGF0aC5zbGljZShzdGFydERvdCwgZW5kKTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBhIHBhdGggZnJvbSBgRm9ybWF0SW5wdXRQYXRoT2JqZWN0YCBvYmplY3QuXG4gKiBAcGFyYW0gcGF0aE9iamVjdCB3aXRoIHBhdGhcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdChwYXRoT2JqZWN0OiBGb3JtYXRJbnB1dFBhdGhPYmplY3QpOiBzdHJpbmcge1xuICBpZiAocGF0aE9iamVjdCA9PT0gbnVsbCB8fCB0eXBlb2YgcGF0aE9iamVjdCAhPT0gXCJvYmplY3RcIikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICBgVGhlIFwicGF0aE9iamVjdFwiIGFyZ3VtZW50IG11c3QgYmUgb2YgdHlwZSBPYmplY3QuIFJlY2VpdmVkIHR5cGUgJHt0eXBlb2YgcGF0aE9iamVjdH1gLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIF9mb3JtYXQoXCIvXCIsIHBhdGhPYmplY3QpO1xufVxuXG4vKipcbiAqIFJldHVybiBhIGBQYXJzZWRQYXRoYCBvYmplY3Qgb2YgdGhlIGBwYXRoYC5cbiAqIEBwYXJhbSBwYXRoIHRvIHByb2Nlc3NcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlKHBhdGg6IHN0cmluZyk6IFBhcnNlZFBhdGgge1xuICBhc3NlcnRQYXRoKHBhdGgpO1xuXG4gIGNvbnN0IHJldDogUGFyc2VkUGF0aCA9IHsgcm9vdDogXCJcIiwgZGlyOiBcIlwiLCBiYXNlOiBcIlwiLCBleHQ6IFwiXCIsIG5hbWU6IFwiXCIgfTtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gcmV0O1xuICBjb25zdCBpc0Fic29sdXRlID0gcGF0aC5jaGFyQ29kZUF0KDApID09PSBDSEFSX0ZPUldBUkRfU0xBU0g7XG4gIGxldCBzdGFydDogbnVtYmVyO1xuICBpZiAoaXNBYnNvbHV0ZSkge1xuICAgIHJldC5yb290ID0gXCIvXCI7XG4gICAgc3RhcnQgPSAxO1xuICB9IGVsc2Uge1xuICAgIHN0YXJ0ID0gMDtcbiAgfVxuICBsZXQgc3RhcnREb3QgPSAtMTtcbiAgbGV0IHN0YXJ0UGFydCA9IDA7XG4gIGxldCBlbmQgPSAtMTtcbiAgbGV0IG1hdGNoZWRTbGFzaCA9IHRydWU7XG4gIGxldCBpID0gcGF0aC5sZW5ndGggLSAxO1xuXG4gIC8vIFRyYWNrIHRoZSBzdGF0ZSBvZiBjaGFyYWN0ZXJzIChpZiBhbnkpIHdlIHNlZSBiZWZvcmUgb3VyIGZpcnN0IGRvdCBhbmRcbiAgLy8gYWZ0ZXIgYW55IHBhdGggc2VwYXJhdG9yIHdlIGZpbmRcbiAgbGV0IHByZURvdFN0YXRlID0gMDtcblxuICAvLyBHZXQgbm9uLWRpciBpbmZvXG4gIGZvciAoOyBpID49IHN0YXJ0OyAtLWkpIHtcbiAgICBjb25zdCBjb2RlID0gcGF0aC5jaGFyQ29kZUF0KGkpO1xuICAgIGlmIChjb2RlID09PSBDSEFSX0ZPUldBUkRfU0xBU0gpIHtcbiAgICAgIC8vIElmIHdlIHJlYWNoZWQgYSBwYXRoIHNlcGFyYXRvciB0aGF0IHdhcyBub3QgcGFydCBvZiBhIHNldCBvZiBwYXRoXG4gICAgICAvLyBzZXBhcmF0b3JzIGF0IHRoZSBlbmQgb2YgdGhlIHN0cmluZywgc3RvcCBub3dcbiAgICAgIGlmICghbWF0Y2hlZFNsYXNoKSB7XG4gICAgICAgIHN0YXJ0UGFydCA9IGkgKyAxO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZW5kID09PSAtMSkge1xuICAgICAgLy8gV2Ugc2F3IHRoZSBmaXJzdCBub24tcGF0aCBzZXBhcmF0b3IsIG1hcmsgdGhpcyBhcyB0aGUgZW5kIG9mIG91clxuICAgICAgLy8gZXh0ZW5zaW9uXG4gICAgICBtYXRjaGVkU2xhc2ggPSBmYWxzZTtcbiAgICAgIGVuZCA9IGkgKyAxO1xuICAgIH1cbiAgICBpZiAoY29kZSA9PT0gQ0hBUl9ET1QpIHtcbiAgICAgIC8vIElmIHRoaXMgaXMgb3VyIGZpcnN0IGRvdCwgbWFyayBpdCBhcyB0aGUgc3RhcnQgb2Ygb3VyIGV4dGVuc2lvblxuICAgICAgaWYgKHN0YXJ0RG90ID09PSAtMSkgc3RhcnREb3QgPSBpO1xuICAgICAgZWxzZSBpZiAocHJlRG90U3RhdGUgIT09IDEpIHByZURvdFN0YXRlID0gMTtcbiAgICB9IGVsc2UgaWYgKHN0YXJ0RG90ICE9PSAtMSkge1xuICAgICAgLy8gV2Ugc2F3IGEgbm9uLWRvdCBhbmQgbm9uLXBhdGggc2VwYXJhdG9yIGJlZm9yZSBvdXIgZG90LCBzbyB3ZSBzaG91bGRcbiAgICAgIC8vIGhhdmUgYSBnb29kIGNoYW5jZSBhdCBoYXZpbmcgYSBub24tZW1wdHkgZXh0ZW5zaW9uXG4gICAgICBwcmVEb3RTdGF0ZSA9IC0xO1xuICAgIH1cbiAgfVxuXG4gIGlmIChcbiAgICBzdGFydERvdCA9PT0gLTEgfHxcbiAgICBlbmQgPT09IC0xIHx8XG4gICAgLy8gV2Ugc2F3IGEgbm9uLWRvdCBjaGFyYWN0ZXIgaW1tZWRpYXRlbHkgYmVmb3JlIHRoZSBkb3RcbiAgICBwcmVEb3RTdGF0ZSA9PT0gMCB8fFxuICAgIC8vIFRoZSAocmlnaHQtbW9zdCkgdHJpbW1lZCBwYXRoIGNvbXBvbmVudCBpcyBleGFjdGx5ICcuLidcbiAgICAocHJlRG90U3RhdGUgPT09IDEgJiYgc3RhcnREb3QgPT09IGVuZCAtIDEgJiYgc3RhcnREb3QgPT09IHN0YXJ0UGFydCArIDEpXG4gICkge1xuICAgIGlmIChlbmQgIT09IC0xKSB7XG4gICAgICBpZiAoc3RhcnRQYXJ0ID09PSAwICYmIGlzQWJzb2x1dGUpIHtcbiAgICAgICAgcmV0LmJhc2UgPSByZXQubmFtZSA9IHBhdGguc2xpY2UoMSwgZW5kKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldC5iYXNlID0gcmV0Lm5hbWUgPSBwYXRoLnNsaWNlKHN0YXJ0UGFydCwgZW5kKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKHN0YXJ0UGFydCA9PT0gMCAmJiBpc0Fic29sdXRlKSB7XG4gICAgICByZXQubmFtZSA9IHBhdGguc2xpY2UoMSwgc3RhcnREb3QpO1xuICAgICAgcmV0LmJhc2UgPSBwYXRoLnNsaWNlKDEsIGVuZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldC5uYW1lID0gcGF0aC5zbGljZShzdGFydFBhcnQsIHN0YXJ0RG90KTtcbiAgICAgIHJldC5iYXNlID0gcGF0aC5zbGljZShzdGFydFBhcnQsIGVuZCk7XG4gICAgfVxuICAgIHJldC5leHQgPSBwYXRoLnNsaWNlKHN0YXJ0RG90LCBlbmQpO1xuICB9XG5cbiAgaWYgKHN0YXJ0UGFydCA+IDApIHJldC5kaXIgPSBwYXRoLnNsaWNlKDAsIHN0YXJ0UGFydCAtIDEpO1xuICBlbHNlIGlmIChpc0Fic29sdXRlKSByZXQuZGlyID0gXCIvXCI7XG5cbiAgcmV0dXJuIHJldDtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGZpbGUgVVJMIHRvIGEgcGF0aCBzdHJpbmcuXG4gKlxuICogICAgICBmcm9tRmlsZVVybChcImZpbGU6Ly8vaG9tZS9mb29cIik7IC8vIFwiL2hvbWUvZm9vXCJcbiAqIEBwYXJhbSB1cmwgb2YgYSBmaWxlIFVSTFxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbUZpbGVVcmwodXJsOiBzdHJpbmcgfCBVUkwpOiBzdHJpbmcge1xuICB1cmwgPSB1cmwgaW5zdGFuY2VvZiBVUkwgPyB1cmwgOiBuZXcgVVJMKHVybCk7XG4gIGlmICh1cmwucHJvdG9jb2wgIT0gXCJmaWxlOlwiKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk11c3QgYmUgYSBmaWxlIFVSTC5cIik7XG4gIH1cbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChcbiAgICB1cmwucGF0aG5hbWUucmVwbGFjZSgvJSg/IVswLTlBLUZhLWZdezJ9KS9nLCBcIiUyNVwiKSxcbiAgKTtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIHBhdGggc3RyaW5nIHRvIGEgZmlsZSBVUkwuXG4gKlxuICogICAgICB0b0ZpbGVVcmwoXCIvaG9tZS9mb29cIik7IC8vIG5ldyBVUkwoXCJmaWxlOi8vL2hvbWUvZm9vXCIpXG4gKiBAcGFyYW0gcGF0aCB0byBjb252ZXJ0IHRvIGZpbGUgVVJMXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b0ZpbGVVcmwocGF0aDogc3RyaW5nKTogVVJMIHtcbiAgaWYgKCFpc0Fic29sdXRlKHBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk11c3QgYmUgYW4gYWJzb2x1dGUgcGF0aC5cIik7XG4gIH1cbiAgY29uc3QgdXJsID0gbmV3IFVSTChcImZpbGU6Ly8vXCIpO1xuICB1cmwucGF0aG5hbWUgPSBlbmNvZGVXaGl0ZXNwYWNlKFxuICAgIHBhdGgucmVwbGFjZSgvJS9nLCBcIiUyNVwiKS5yZXBsYWNlKC9cXFxcL2csIFwiJTVDXCIpLFxuICAp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