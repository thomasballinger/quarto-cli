/*
* watch.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { ServerRequest } from "http/server.ts";

import { extname, join, relative } from "path/mod.ts";
import { existsSync } from "fs/mod.ts";

import { acceptWebSocket, WebSocket } from "ws/mod.ts";

import { ld } from "lodash/mod.ts";

import { message } from "../../core/console.ts";
import { pathWithForwardSlashes } from "../../core/path.ts";

import { kOutputDir, ProjectContext } from "../../project/project-context.ts";
import {
  copyResourceFile,
  projectResourceFiles,
} from "../../project/project-resources.ts";

import { kLocalhost, ServeOptions } from "./serve.ts";

export interface ProjectWatcher {
  handle: (req: ServerRequest) => boolean;
  connect: (req: ServerRequest) => Promise<void>;
  injectClient: (file: Uint8Array) => Uint8Array;
}

export function watchProject(
  project: ProjectContext,
  options: ServeOptions,
): ProjectWatcher {
  // error display
  const displayError = (e: Error) => {
    if (options.debug) {
      console.error(e);
    }
    message((e as Error).message);
  };
  const displaySocketError = (e: Error) => {
    if (!(e instanceof Deno.errors.BrokenPipe)) {
      displayError(e);
    }
  };

  // calculate output dir and resource files (those will be the
  // triggers for reloading)
  const projDir = Deno.realPathSync(project.dir);
  const outputDirConfig = project.metadata?.project?.[kOutputDir];
  const outputDir = outputDirConfig
    ? Deno.realPathSync(join(projDir, outputDirConfig))
    : projDir;
  const resourceFiles = projectResourceFiles(project);

  // track every path that has been modified since the last reload
  const modified: string[] = [];

  // handle a watch event (return true if a reload should occur)
  const handleWatchEvent = (event: Deno.FsEvent) => {
    try {
      if (["modify", "create"].includes(event.kind)) {
        // track modified
        modified.push(...event.paths);

        // filter out paths that no longer exist and create real paths
        const paths = event.paths.filter(existsSync).map(Deno.realPathSync);

        // if any of the paths are in the output dir then return true
        if (paths.some((path) => path.startsWith(outputDir))) {
          return true;
        }

        // if it's a resource file, then copy it and return false
        // (the copy will come in as another change)
        const modifiedResources = ld.intersection(
          resourceFiles,
          paths,
        ) as string[];
        for (const file of modifiedResources) {
          const sourcePath = relative(projDir, file);
          const destPath = join(outputDir, sourcePath);
          copyResourceFile(projDir, file, destPath);
        }

        return false;
      } else {
        return false;
      }
    } catch (e) {
      displayError(e);
      return false;
    }
  };

  // track client clients
  const clients: WebSocket[] = [];

  // debounced function for notifying all clients of a change
  // (ensures that we wait for bulk file copying to complete
  // before triggering the reload)
  const reloadClients = ld.debounce(async () => {
    // see if there is a reload target (last html file modified)
    const lastHtmlFile = ld.uniq(modified).reverse().find((file) => {
      return extname(file) === ".html";
    });
    let reloadTarget = "";
    if (lastHtmlFile && options.navigate) {
      if (lastHtmlFile.startsWith(outputDir)) {
        reloadTarget = "/" + relative(outputDir, lastHtmlFile);
      } else {
        reloadTarget = "/" + relative(projDir, lastHtmlFile);
      }
      reloadTarget = pathWithForwardSlashes(reloadTarget);
    }
    modified.splice(0, modified.length);

    for (let i = clients.length - 1; i >= 0; i--) {
      const socket = clients[i];
      try {
        await socket.send(`reload${reloadTarget}`);
      } catch (e) {
        displaySocketError(e);
      } finally {
        if (!socket.isClosed) {
          socket.close().catch(displaySocketError);
        }
        clients.splice(i, 1);
      }
    }
  }, 50);

  // watch project dir recursively
  const watcher = Deno.watchFs(project.dir, { recursive: true });
  const watchForChanges = () => {
    watcher.next().then(async (iter) => {
      // see if we need to handle this
      if (handleWatchEvent(iter.value)) {
        await reloadClients();
      }
      // keep watching
      watchForChanges();
    });
  };
  watchForChanges();

  // return watcher interface
  return {
    handle: (req: ServerRequest) => {
      return !!options.watch && (req.headers.get("upgrade") === "websocket");
    },
    connect: async (req: ServerRequest) => {
      const { conn, r: bufReader, w: bufWriter, headers } = req;
      try {
        const socket = await acceptWebSocket({
          conn,
          bufReader,
          bufWriter,
          headers,
        });
        clients.push(socket);
      } catch (e) {
        displaySocketError(e);
      }
    },
    injectClient: (file: Uint8Array) => {
      if (options.watch) {
        const scriptContents = new TextEncoder().encode(
          watchClientScript(options.port),
        );
        const fileWithScript = new Uint8Array(
          file.length + scriptContents.length,
        );
        fileWithScript.set(file);
        fileWithScript.set(scriptContents, file.length);
        return fileWithScript;
      } else {
        return file;
      }
    },
  };
}

function watchClientScript(port: number): string {
  return `
<script>
  const socket = new WebSocket('ws://${kLocalhost}:${port}');
  socket.onopen = () => {
    console.log('Socket connection open. Listening for events.');
  };
  socket.onmessage = (msg) => {
    if (msg.data.startsWith('reload')) {
      socket.close();
      const target = msg.data.replace(/^reload/, "");
      if (target) {
        window.location.replace(target.replace(/index\.html$/, ""))
      } else {
        window.location.reload(true);
      }
    } 
  };
</script>`;
}