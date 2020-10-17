/*
* engine.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
* Unless you have received this program directly from RStudio pursuant
* to the terms of a commercial license agreement with RStudio, then
* this program is licensed to you under the terms of version 3 of the
* GNU General Public License. This program is distributed WITHOUT
* ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
* MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
* GPL (http://www.gnu.org/licenses/gpl-3.0.txt) for more details.
*
*/

import { extname } from "path/mod.ts";

import type { Format } from "../api/format.ts";

import type { Metadata } from "../config/metadata.ts";

import { rmdEngine } from "./rmd.ts";
import { ipynbEngine } from "./ipynb.ts";
import type { PandocIncludes } from "../core/pandoc.ts";
import { ProcessResult } from "../core/process.ts";

export interface ExecuteOptions {
  input: string;
  output: string;
  format: Format;
  cwd?: string;
  params?: string | { [key: string]: unknown };
  quiet?: boolean;
}

export interface PostProcessOptions {
  input: string;
  format: Format;
  output: string;
  data: unknown;
  quiet?: boolean;
}

export interface RunOptions {
  input: string;
  render: boolean;
  port?: number;
}

export interface ExecuteResult {
  supporting: string[];
  includes: PandocIncludes;
  postprocess?: unknown;
}

export interface ComputationEngine {
  name: string;
  canHandle: (ext: string) => boolean;
  metadata: (file: string) => Promise<Metadata>;
  execute: (options: ExecuteOptions) => Promise<ExecuteResult>;
  postprocess: (options: PostProcessOptions) => Promise<void>;
  run: (options: RunOptions) => Promise<ProcessResult>;
}

export function computationEngineForFile(file: string) {
  const engines = [
    rmdEngine,
    ipynbEngine,
  ];

  const ext = extname(file);
  for (const engine of engines) {
    if (engine.canHandle(ext)) {
      return engine;
    }
  }

  return null;
}
