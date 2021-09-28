/*
* text.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

import { glb } from "./binary-search.ts";

export function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function normalizeNewlines(text: string) {
  return lines(text).join("\n");
}

export function lineNumbers(text: string) {
  const lineOffsets = [0];
  for (const m of text.matchAll(/\r?\n/g)) {
    // FIXME Why is typescript getting the types wrong here?
    lineOffsets.push(m[0].length + (m as any).index);
  }
  lineOffsets.push(text.length);

  return function(offset: number) {
    const startIndex = glb(lineOffsets, offset);
    
    return {
      line: startIndex,
      column: offset - lineOffsets[startIndex]
    }
  }
}
