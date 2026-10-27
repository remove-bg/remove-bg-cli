// Tiny JPEG/TIFF byte builder used by test/exif.test.js to craft EXIF, IPTC and XMP
// payloads that drive specific branches of remove-bg-tools/exif.js.
//
// IFD entries look like one of:
//   { tag, type, values }          encoded per TIFF spec (<= 4 bytes inline, otherwise in the value area)
//   { tag, type, count, raw }      `raw` is written verbatim into the 4-byte value/offset field
// Values: type 2 takes a string (NUL appended); types 1/7 take numbers or a string (char codes);
// types 5/10 take [numerator, denominator] pairs; everything else takes numbers.

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 8: 2, 9: 4, 10: 8 };

function ascii(str) {
	return Array.from(str, c => c.charCodeAt(0));
}

function u16(v, bigEnd) {
	const b = [(v >>> 8) & 0xff, v & 0xff];
	return bigEnd ? b : b.reverse();
}

function u32(v, bigEnd) {
	v = v >>> 0;
	const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
	return bigEnd ? b : b.reverse();
}

function encodeValue(entry, bigEnd) {
	const { type } = entry;
	let values = entry.values;
	if (type === 2) {
		const bytes = ascii(values).concat(0);
		return { count: bytes.length, bytes };
	}
	if (typeof values === 'string') values = ascii(values);
	if (!Array.isArray(values) || (TYPE_SIZE[type] === 8 && !Array.isArray(values[0]))) values = [values];
	let bytes = [];
	for (const v of values) {
		switch (type) {
			case 1:
			case 7:
				bytes.push(v & 0xff);
				break;
			case 3:
			case 8:
				bytes = bytes.concat(u16(v, bigEnd));
				break;
			case 4:
			case 9:
				bytes = bytes.concat(u32(v, bigEnd));
				break;
			case 5:
			case 10:
				bytes = bytes.concat(u32(v[0], bigEnd), u32(v[1], bigEnd));
				break;
			default:
				throw new Error('Unsupported type ' + type);
		}
	}
	return { count: values.length, bytes };
}

function pad2(n) {
	return n + (n % 2);
}

function encodeIfd(entries, bigEnd) {
	const encoded = entries.map(entry => {
		if (entry.pointer) return Object.assign({}, entry, { count: 1, bytes: null });
		if (entry.raw !== undefined) return Object.assign({}, entry, { bytes: null });
		return Object.assign({}, entry, encodeValue(entry, bigEnd));
	});
	const dataSize = encoded.reduce((sum, e) => sum + (e.bytes && e.bytes.length > 4 ? pad2(e.bytes.length) : 0), 0);
	return { encoded, size: 2 + 12 * encoded.length + 4 + dataSize };
}

function writeIfd(out, ifd, pos, nextOffset, pointers, bigEnd) {
	if (out.length !== pos) throw new Error('IFD layout mismatch');
	const { encoded } = ifd;
	let dataPos = pos + 2 + 12 * encoded.length + 4;
	const data = [];
	out.push(...u16(encoded.length, bigEnd));
	for (const e of encoded) {
		out.push(...u16(e.tag, bigEnd), ...u16(e.type, bigEnd), ...u32(e.count, bigEnd));
		if (e.pointer) {
			out.push(...u32(pointers[e.pointer], bigEnd));
		} else if (e.raw !== undefined) {
			out.push(...u32(e.raw, bigEnd));
		} else if (e.bytes.length <= 4) {
			out.push(...e.bytes, ...new Array(4 - e.bytes.length).fill(0));
		} else {
			out.push(...u32(dataPos, bigEnd));
			const padded = e.bytes.concat(e.bytes.length % 2 ? [0] : []);
			data.push(...padded);
			dataPos += padded.length;
		}
	}
	out.push(...u32(nextOffset, bigEnd));
	out.push(...data);
}

// Builds a TIFF structure (as used inside the EXIF APP1 segment). Offsets are TIFF-relative.
function buildTiff(opts = {}) {
	const bigEnd = !!opts.bigEnd;
	const ifd0Entries = (opts.ifd0 || []).slice();
	if (opts.exif) ifd0Entries.push({ tag: 0x8769, type: 4, pointer: 'exif' });
	if (opts.gps) ifd0Entries.push({ tag: 0x8825, type: 4, pointer: 'gps' });
	let ifd1Entries = opts.ifd1 ? opts.ifd1.slice() : null;
	if (opts.thumbnail) {
		ifd1Entries = ifd1Entries || [{ tag: 0x0103, type: 3, values: 6 }];
		ifd1Entries.push({ tag: 0x0201, type: 4, pointer: 'thumb' });
		ifd1Entries.push({ tag: 0x0202, type: 4, values: opts.thumbnail.length });
	}

	const ifd0 = encodeIfd(ifd0Entries, bigEnd);
	const exif = opts.exif ? encodeIfd(opts.exif, bigEnd) : null;
	const gps = opts.gps ? encodeIfd(opts.gps, bigEnd) : null;
	const ifd1 = ifd1Entries ? encodeIfd(ifd1Entries, bigEnd) : null;

	const pointers = {};
	let pos = 8 + ifd0.size;
	if (exif) { pointers.exif = pos; pos += exif.size; }
	if (gps) { pointers.gps = pos; pos += gps.size; }
	if (ifd1) { pointers.ifd1 = pos; pos += ifd1.size; }
	if (opts.thumbnail) pointers.thumb = pos;

	const out = [];
	out.push(...ascii(opts.byteOrder || (bigEnd ? 'MM' : 'II')));
	out.push(...u16(opts.magic === undefined ? 0x2A : opts.magic, bigEnd));
	out.push(...u32(opts.firstIFDOffset === undefined ? 8 : opts.firstIFDOffset, bigEnd));
	const ifd0Next = opts.ifd1Offset !== undefined ? opts.ifd1Offset : (ifd1 ? pointers.ifd1 : 0);
	writeIfd(out, ifd0, 8, ifd0Next, pointers, bigEnd);
	if (exif) writeIfd(out, exif, pointers.exif, 0, pointers, bigEnd);
	if (gps) writeIfd(out, gps, pointers.gps, 0, pointers, bigEnd);
	if (ifd1) writeIfd(out, ifd1, pointers.ifd1, 0, pointers, bigEnd);
	if (opts.thumbnail) out.push(...opts.thumbnail);
	return out;
}

// A JPEG marker segment; the big-endian length includes the two length bytes themselves
function segment(marker, payload) {
	const len = payload.length + 2;
	return [0xFF, marker, (len >>> 8) & 0xff, len & 0xff].concat(payload);
}

const app0 = () => segment(0xE0, ascii('JFIF').concat([0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
const exifSegment = tiffBytes => segment(0xE1, ascii('Exif').concat([0, 0], tiffBytes));
const xmpSegment = xml => segment(0xE1, ascii('http://ns.adobe.com/xap/1.0/').concat([0], ascii(xml)));

// IPTC-IIM dataset: 0x1C <record> <dataset> <int16 length> <data>
function iptcRecord(dataset, value, record = 2) {
	const bytes = typeof value === 'string' ? ascii(value) : value;
	return [0x1C, record, dataset, (bytes.length >>> 8) & 0xff, bytes.length & 0xff].concat(bytes);
}

// Photoshop APP13 with a single 8BIM 0x0404 (IPTC) resource. `nameBytes` are the two bytes
// following the resource id (an empty, padded Pascal string by default).
function iptcSegment(records, nameBytes = [0, 0], sizeBytes) {
	const data = [].concat(...records);
	const size = sizeBytes || u32(data.length, true);
	return segment(0xED, ascii('Photoshop 3.0').concat([0], ascii('8BIM'), [0x04, 0x04], nameBytes, size, data));
}

function jpeg(...segments) {
	return [0xFF, 0xD8].concat(...segments, [0xFF, 0xD9]);
}

function toArrayBuffer(bytes) {
	return new Uint8Array(bytes).buffer;
}

function toDataURI(bytes, mime = 'image/jpeg') {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return 'data:' + mime + ';base64,' + btoa(binary);
}

module.exports = {
	ascii,
	u32,
	buildTiff,
	segment,
	app0,
	exifSegment,
	xmpSegment,
	iptcRecord,
	iptcSegment,
	jpeg,
	toArrayBuffer,
	toDataURI,
};
