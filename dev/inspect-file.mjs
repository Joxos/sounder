// Inspect the user's actual test file with mediabunny (Node + FilePathSource).
import { Input, ALL_FORMATS, FilePathSource, BlobSource, AudioSampleSink } from 'mediabunny';
import { statSync } from 'node:fs';
import path from 'node:path';

const filePath = process.argv[2];
console.log('exists:', filePath, statSync(filePath).size, 'bytes');

const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(filePath) });
console.log('canRead:', await input.canRead());
const format = await input.getFormat();
console.log('format :', format.name ?? format.constructor.name);
console.log('mime   :', format.mimeType ?? '-');

const track = await input.getPrimaryAudioTrack();
console.log('track  :', track ? 'present' : 'MISSING');
if (track) {
	console.log('canDecode:', await track.canDecode());
	console.log('sampleRate:', await track.getSampleRate());
	const cfg = await track.getDecoderConfig();
	console.log('codec  :', cfg?.codec, 'desc bytes:', cfg?.description?.length ?? 0);
}

console.log('duration:', (await input.computeDuration()).toFixed(3), 's');

// Count decoded frames/channels without keeping the whole file.
const sink = new AudioSampleSink(track);
let frames = 0;
let channels = 0;
let firstSr = null;
for await (const sample of sink.samples()) {
	if (firstSr === null) firstSr = sample.sampleRate;
	channels = Math.max(channels, sample.numberOfChannels);
	frames += sample.numberOfFrames;
}
console.log('decoded frames:', frames, 'channels:', channels, 'sampleRate:', firstSr);
console.log('decoded seconds:', (frames / (firstSr ?? 1)).toFixed(3));
input.dispose();
void path;
void BlobSource;
