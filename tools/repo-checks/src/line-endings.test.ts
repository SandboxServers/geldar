import { describe, expect, it } from 'vitest';
import { findCrlfInIndex } from './line-endings.ts';

describe('findCrlfInIndex', () => {
  it('flags CRLF and mixed files in the index, but not the working tree', () => {
    const output = [
      'i/lf    w/crlf  attr/text eol=lf      \tdocs/spec.md',
      'i/crlf  w/crlf  attr/text eol=lf      \tscripts/run.sh',
      'i/mixed w/mixed attr/                 \tnotes.txt',
      'i/crlf  w/crlf  attr/text eol=crlf    \tplugin/gradlew.bat',
      'i/-text w/-text attr/                 \tlogo.png',
      '',
    ].join('\n');
    expect(findCrlfInIndex(output)).toEqual(['scripts/run.sh', 'notes.txt']);
  });

  it('keeps paths that contain spaces', () => {
    expect(findCrlfInIndex('i/crlf  w/crlf  attr/  \tdocs/a b.md\n')).toEqual(['docs/a b.md']);
  });
});
