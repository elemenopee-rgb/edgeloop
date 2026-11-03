import test from 'node:test';
import assert from 'node:assert/strict';
import { groupClipsByCue, pickClip, isAudioFile } from './voice-clips.js';

const f = (path, type = '') => ({ name: path.split('/').pop(), type, webkitRelativePath: path });

test('groups audio files by the cue folder above them', () => {
    const files = [
        f('lib/edge/a.mp3'),
        f('lib/Edge/b.wav', 'audio/wav'),
        f('lib/encourage/c.ogg'),
        f('lib/edge/notes.txt'),
        f('lib/unknown/d.mp3'),
        f('lib/top.mp3'),
        f('c.mp3')
    ];
    const g = groupClipsByCue(files, ['edge', 'encourage', 'forceOrgasm']);
    assert.deepEqual(Object.keys(g).sort(), ['edge', 'encourage']);
    assert.equal(g.edge.length, 2);
    assert.equal(g.encourage.length, 1);
});

test('matches cue ids case-insensitively and accepts a picked cue folder', () => {
    const g = groupClipsByCue([f('forceorgasm/x.m4a')], ['forceOrgasm']);
    assert.equal(g.forceOrgasm.length, 1);
});

test('isAudioFile uses mime type or extension', () => {
    assert.ok(isAudioFile({ name: 'x', type: 'audio/mpeg' }));
    assert.ok(isAudioFile({ name: 'x.FLAC', type: '' }));
    assert.ok(!isAudioFile({ name: 'x.txt', type: 'text/plain' }));
});

test('pickClip avoids an immediate repeat and handles empties', () => {
    assert.equal(pickClip([]), null);
    assert.equal(pickClip(['a'], 'a'), 'a');
    for (let i = 0; i < 20; i++) assert.equal(pickClip(['a', 'b'], 'a'), 'b');
    assert.equal(pickClip(['a', 'b', 'c'], null, () => 0.99), 'c');
});
