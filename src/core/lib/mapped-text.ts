/**
* mapped-text.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
* FIXME consider making MappedString an actual subclass of String,
* just with extra fields.
*
*/

import { glb } from "./binary-search.ts";
import { Range, rangedLines } from "./ranged-text.ts";
import { lines, lineNumbers } from "./text.ts";

export interface MappedString {
  value: string,
  originalString: string,
  map: (a: number) => number | undefined,
  mapClosest: (a: number) => number | undefined
};

export type StringChunk = string | Range;

/** 
mappedString provides a mechanism for maintaining offset information
through substrings. This comes up often in quarto, where we often pull
a part of a larger string, send that to an interpreter, compiler or
validator, and then want to report error information with respect to
line information in the first string.

You construct a mappedString from a list of substring ranges of an
original string (or unmappable "new" substrings), which are
concatenated into the result in the field `value`. 

In the field `originalString`, we keep the "original string"

In addition to this new string, mappedString returns two functions:

- a function `map` that sends offset from this new
string into offsets of the old string.

- a function `mapClosest` attempts to avoid undefined results by
returning the closest smaller result that is valid in case it's called
with a value that has no inverse.

If you pass a MappedString as the input to this function, the result's
map will walk the inverse maps all the way to the raw, unmapped
string (which will be stored in `originalString`).

This provides a natural composition for mapped strings.
*/
export function mappedString(
  source: string | MappedString, pieces: StringChunk[]
): MappedString
{
  interface OffsetInfo {
    fromSource: boolean;
    length: number;
    offset: number;
    range?: Range
  };
  
  if (typeof source === "string") {
    const offsetInfo: OffsetInfo[] = [];
    let offset = 0;

    const resultList = pieces.map(piece => {
      if (typeof piece === "string") {
        offsetInfo.push({
          fromSource: false,
          length: piece.length,
          offset
        });
        offset += piece.length;
        return piece;
      } else {
        const resultPiece = source.substring(piece.start, piece.end);
        offsetInfo.push({
          fromSource: true,
          length: resultPiece.length,
          offset,
          range: {
            start: piece.start,
            end: piece.end
          }
        });
        offset += resultPiece.length;
        return resultPiece;
      }
    });

    const value = resultList.join("");

    function map(targetOffset: number) {
      const ix = glb(
        offsetInfo,
        { offset: targetOffset },
        // deno-lint-ignore no-explicit-any
        (a: any, b: any) => a.offset - b.offset);
      if (ix < 0) {
        return undefined;
      }
      const info = offsetInfo[ix];
      if (!info.fromSource) {
        return undefined;
      }
      const localOffset = targetOffset - info.offset;
      
      if (localOffset >= info.length) {
        return undefined;
      }
      return info.range!.start + localOffset;
    }

    // This is a version of map() that returns the closest point (on
    // the left, "'price is right' rules") in the source, in case we
    // ask for a non-existing point. This comes up in practice in
    // quarto where we strip the original source of newlines and
    // replace them with our own, making it easy for errors to include
    // "inner" substrings that have no mapping back to the original
    // source.
    function mapClosest(targetOffset: number) {
      if (offsetInfo.length === 0 || targetOffset < 0) {
        return undefined;
      }
      const firstIx = glb(
        offsetInfo,
        { offset: targetOffset },
        // deno-lint-ignore no-explicit-any
        (a: any, b: any) => a.offset - b.offset);

      let ix = firstIx;
      let smallestSourceInfo: undefined | OffsetInfo = undefined;
      while (ix >= 0) {
        const info = offsetInfo[ix];
        if (!info.fromSource) {
          ix--;
          continue;
        }
        smallestSourceInfo = info;
        if (ix === firstIx) {
          const localOffset = targetOffset - info.offset;
      
          if (localOffset < info.length) {
            return info.range!.start + localOffset;
          }
        }
        return info.range!.end - 1;
      }
      if (smallestSourceInfo === undefined) {
        return undefined;
      } else {
        return (smallestSourceInfo as OffsetInfo).range!.start;
      }
    }
    
    return {
      value,
      originalString: source,
      map,
      mapClosest
    }
  } else {
    const {
      value,
      originalString,
      map: previousMap,
      mapClosest: previousMapClosest,
    } = source;

    const {
      value: resultValue,
      map: nextMap,
      mapClosest: nextMapClosest
    } = mappedString(value, pieces);

    function composeMap(offset: number) {
      const v = nextMap(offset);
      if (v === undefined) {
        return v;
      }
      return previousMap(v);
    }

    function composeMapClosest(offset: number) {
      const v = nextMapClosest(offset);
      if (v === undefined) {
        return v;
      }
      return previousMapClosest(v);
    }
    
    return {
      value: resultValue,
      originalString,
      map: composeMap,
      mapClosest: composeMapClosest
    };
  }
}

export function asMappedString(str: string)
{
  return {
    value: str,
    originalString: str,
    map: (x: number) => x,
    mapClosest: (x: number) => x
  };
}

// This assumes all originalString fields in the MappedString
// parameters to be the same
export function mappedConcat(strings: MappedString[]): MappedString
{
  if (strings.length === 0) {
    throw new Error("strings must be non-empty");
  }
  let currentOffset = 0;
  const offsets: number[] = [];
  for (const s of strings) {
    currentOffset += s.value.length;
    offsets.push(currentOffset);
  }
  const value = "".concat(...strings.map(s => s.value));
  return {
    value,
    originalString: strings[0].originalString,
    map(offset: number) {
      if (offset < 0 || offset >= value.length) {
        return undefined;
      }
      const ix = glb(offsets, offset);
      return strings[ix].map(offset - offsets[ix]);
    },
    mapClosest(offset: number) {
      if (offset < 0 || offset >= value.length) {
        return undefined;
      }
      const ix = glb(offsets, offset);
      return strings[ix].mapClosest(offset - offsets[ix]);
    }
  };
}

export function mappedLineNumbers(text: MappedString) {
  const f = lineNumbers(text.originalString);
  
  return function(offset: number) {
    const n = text.mapClosest(offset);
    if (n === undefined) {
      throw new Error("Internal Error: bad offset in mappedLineNumbers");
    }
    return f(n);
  }
}
