/** @jest-environment jsdom */

const {
	ascii,
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
} = require('./helpers/exifJpegBuilder');

const EXIF = require('../remove-bg-tools/exif');

const THUMB = [0xFF, 0xD8, 0xFF, 0xD9];

// IFD0 / Exif / GPS / IFD1 entries exercising every supported TIFF type, both inline and offset values
function fullTiff(bigEnd) {
	return buildTiff({
		bigEnd,
		ifd0: [
			{ tag: 0x0100, type: 4, values: 640 }, // ImageWidth: long
			{ tag: 0x0101, type: 9, values: -480 }, // ImageHeight: slong
			{ tag: 0x0102, type: 3, values: [8, 8, 8] }, // BitsPerSample: 3 shorts (offset)
			{ tag: 0x0212, type: 3, values: [2, 1] }, // YCbCrSubSampling: 2 shorts (inline)
			{ tag: 0x0112, type: 3, values: 6 }, // Orientation: short
			{ tag: 0x011A, type: 5, values: [72, 1] }, // XResolution: rational
			{ tag: 0x011B, type: 5, values: [300, 4] }, // YResolution: rational
			{ tag: 0x013E, type: 5, values: [[313, 1000], [329, 1000]] }, // WhitePoint: 2 rationals
			{ tag: 0x0111, type: 4, values: [100, 200] }, // StripOffsets: 2 longs
			{ tag: 0x012D, type: 9, values: [-1, 2] }, // TransferFunction: 2 slongs
			{ tag: 0x0211, type: 10, values: [-299, 1000] }, // YCbCrCoefficients: srational
			{ tag: 0x013F, type: 10, values: [[-1, 2], [3, -4]] }, // PrimaryChromaticities: 2 srationals
			{ tag: 0x011C, type: 1, values: 1 }, // PlanarConfiguration: byte
			{ tag: 0x0115, type: 7, values: [1, 2, 3] }, // SamplesPerPixel: 3 undefined (inline)
			{ tag: 0x0214, type: 1, values: [0, 1, 2, 3, 4, 5] }, // ReferenceBlackWhite: 6 bytes (offset)
			{ tag: 0x010F, type: 2, values: 'Canon Inc.' }, // Make: ascii (offset)
			{ tag: 0x0110, type: 2, values: 'X1' }, // Model: ascii (inline)
			{ tag: 0x8298, type: 8, values: 1 }, // Copyright: SSHORT is not supported
			{ tag: 0xBEEF, type: 3, values: 1 }, // unknown tag, skipped
		],
		exif: [
			{ tag: 0x829A, type: 5, values: [1, 250] }, // ExposureTime
			{ tag: 0x829D, type: 5, values: [28, 10] }, // FNumber
			{ tag: 0x8822, type: 3, values: 2 }, // ExposureProgram
			{ tag: 0x8827, type: 3, values: 400 }, // ISOSpeedRatings
			{ tag: 0x9000, type: 7, values: '0230' }, // ExifVersion
			{ tag: 0xA000, type: 7, values: '0100' }, // FlashpixVersion
			{ tag: 0x9101, type: 7, values: [1, 2, 3, 0] }, // ComponentsConfiguration
			{ tag: 0x9003, type: 2, values: '2024:12:09 10:11:12' }, // DateTimeOriginal
			{ tag: 0x9207, type: 3, values: 5 }, // MeteringMode
			{ tag: 0x9208, type: 3, values: 1 }, // LightSource
			{ tag: 0x9209, type: 3, values: 0x19 }, // Flash
			{ tag: 0xA217, type: 3, values: 2 }, // SensingMethod
			{ tag: 0xA406, type: 3, values: 1 }, // SceneCaptureType
			{ tag: 0xA301, type: 7, values: 1 }, // SceneType
			{ tag: 0xA300, type: 7, values: 3 }, // FileSource
			{ tag: 0xA401, type: 3, values: 0 }, // CustomRendered
			{ tag: 0xA403, type: 3, values: 1 }, // WhiteBalance
			{ tag: 0xA407, type: 3, values: 2 }, // GainControl
			{ tag: 0xA408, type: 3, values: 1 }, // Contrast
			{ tag: 0xA409, type: 3, values: 2 }, // Saturation
			{ tag: 0xA40A, type: 3, values: 2 }, // Sharpness
			{ tag: 0xA40C, type: 3, values: 3 }, // SubjectDistanceRange
			{ tag: 0xA002, type: 4, values: 640 }, // PixelXDimension
			{ tag: 0x1234, type: 3, values: 1 }, // unknown tag, skipped
		],
		gps: [
			{ tag: 0x0000, type: 1, values: [2, 3, 0, 0] }, // GPSVersionID
			{ tag: 0x0001, type: 2, values: 'N' }, // GPSLatitudeRef
			{ tag: 0x0002, type: 5, values: [[48, 1], [51, 1], [2988, 100]] }, // GPSLatitude
			{ tag: 0x0006, type: 5, values: [1000, 10] }, // GPSAltitude
		],
		ifd1: [
			{ tag: 0x0103, type: 3, values: 6 }, // Compression: JPEG
			{ tag: 0x011A, type: 5, values: [72, 1] }, // XResolution
		],
		thumbnail: THUMB,
	});
}

function getData(img) {
	return new Promise((resolve, reject) => {
		const started = EXIF.getData(img, function () {
			resolve(this);
		}, reject);
		if (!started) reject(new Error('EXIF.getData returned false'));
	});
}

function readBlob(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(Array.from(new Uint8Array(reader.result)));
		reader.onerror = reject;
		reader.readAsArrayBuffer(blob);
	});
}

// Index of the TIFF header within a JPEG built with exifSegment()
function tiffStartOf(bytes) {
	const s = String.fromCharCode(...bytes);
	return s.indexOf('Exif\0\0') + 6;
}

class FakeXHR {
	constructor() {
		FakeXHR.instances.push(this);
	}
	open(method, url, async) {
		this.method = method;
		this.url = url;
		this.async = async;
	}
	send(body) {
		this.sentBody = body;
	}
}

let logSpy;

beforeEach(() => {
	logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	logSpy.mockRestore();
	EXIF.disableXmp();
});

describe('EXIF wrapper constructor', () => {
	test('wraps objects with or without new and passes instances through', () => {
		const obj = {};
		const wrapped = EXIF(obj);
		expect(wrapped).toBeInstanceOf(EXIF);
		expect(wrapped.EXIFwrapped).toBe(obj);
		expect(new EXIF(obj).EXIFwrapped).toBe(obj);
		expect(EXIF(wrapped)).toBe(wrapped);
		expect(EXIF.EXIF).toBe(EXIF);
	});

	test('exposes the tag tables', () => {
		expect(EXIF.Tags[0x9000]).toBe('ExifVersion');
		expect(EXIF.TiffTags[0x0112]).toBe('Orientation');
		expect(EXIF.GPSTags[0x0002]).toBe('GPSLatitude');
		expect(EXIF.IFD1Tags[0x0201]).toBe('JpegIFOffset');
		expect(EXIF.StringValues.Flash[0x19]).toBe('Flash fired, auto mode');
	});
});

describe.each([
	['little-endian (II)', false],
	['big-endian (MM)', true],
])('readFromBinaryFile with a %s TIFF', (name, bigEnd) => {
	let tags;

	beforeAll(() => {
		tags = EXIF.readFromBinaryFile(toArrayBuffer(jpeg(app0(), exifSegment(fullTiff(bigEnd)))));
	});

	test('reads IFD0 values of every supported type', () => {
		expect(tags.ImageWidth).toBe(640);
		expect(tags.ImageHeight).toBe(-480);
		expect(tags.BitsPerSample).toEqual([8, 8, 8]);
		expect(tags.YCbCrSubSampling).toEqual([2, 1]);
		expect(tags.Orientation).toBe(6);
		expect(tags.StripOffsets).toEqual([100, 200]);
		expect(tags.TransferFunction).toEqual([-1, 2]);
		expect(tags.YCbCrCoefficients).toBeCloseTo(-0.299);
		expect(tags.PrimaryChromaticities).toEqual([-0.5, -0.75]);
		expect(tags.PlanarConfiguration).toBe(1);
		expect(tags.SamplesPerPixel).toEqual([1, 2, 3]);
		expect(tags.ReferenceBlackWhite).toEqual([0, 1, 2, 3, 4, 5]);
		expect(tags.Make).toBe('Canon Inc.');
		expect(tags.Model).toBe('X1');
	});

	test('returns rationals as Number objects carrying numerator/denominator', () => {
		expect(tags.XResolution).toBeInstanceOf(Number);
		expect(tags.XResolution.valueOf()).toBe(72);
		expect(tags.XResolution.numerator).toBe(72);
		expect(tags.XResolution.denominator).toBe(1);
		expect(tags.YResolution.valueOf()).toBe(75);
		expect(tags.WhitePoint.map(Number)).toEqual([0.313, 0.329]);
		expect(tags.WhitePoint[1].numerator).toBe(329);
		expect(tags.WhitePoint[1].denominator).toBe(1000);
	});

	test('maps unsupported types to undefined and skips unknown tags', () => {
		expect(Object.keys(tags)).toContain('Copyright');
		expect(tags.Copyright).toBeUndefined();
		expect(Object.keys(tags).some(k => /^\d+$/.test(k) || k === 'undefined')).toBe(false);
	});

	test('post-processes Exif IFD values', () => {
		expect(tags.ExifIFDPointer).toBeGreaterThan(8);
		expect(tags.ExposureTime.valueOf()).toBe(0.004);
		expect(tags.FNumber.valueOf()).toBe(2.8);
		expect(tags.ISOSpeedRatings).toBe(400);
		expect(tags.DateTimeOriginal).toBe('2024:12:09 10:11:12');
		expect(tags.PixelXDimension).toBe(640);
		expect(tags.ExifVersion).toBe('0230');
		expect(tags.FlashpixVersion).toBe('0100');
		expect(tags.ComponentsConfiguration).toBe('YCbCr');
		expect(tags).toMatchObject({
			ExposureProgram: 'Normal program',
			MeteringMode: 'Pattern',
			LightSource: 'Daylight',
			Flash: 'Flash fired, auto mode',
			SensingMethod: 'One-chip color area sensor',
			SceneCaptureType: 'Landscape',
			SceneType: 'Directly photographed',
			FileSource: 'DSC',
			CustomRendered: 'Normal process',
			WhiteBalance: 'Manual white balance',
			GainControl: 'High gain up',
			Contrast: 'Soft',
			Saturation: 'High saturation',
			Sharpness: 'Hard',
			SubjectDistanceRange: 'Distant view',
		});
	});

	test('reads GPS IFD values', () => {
		expect(tags.GPSInfoIFDPointer).toBeGreaterThan(tags.ExifIFDPointer);
		expect(tags.GPSVersionID).toBe('2.3.0.0');
		expect(tags.GPSLatitudeRef).toBe('N');
		expect(tags.GPSLatitude.map(Number)).toEqual([48, 51, 29.88]);
		expect(tags.GPSAltitude.valueOf()).toBe(100);
	});

	test('extracts the JPEG thumbnail from IFD1 as a Blob', async () => {
		const { thumbnail } = tags;
		expect(thumbnail.Compression).toBe(6);
		expect(thumbnail.XResolution.valueOf()).toBe(72);
		expect(thumbnail.JpegIFByteCount).toBe(THUMB.length);
		expect(thumbnail.JpegIFOffset).toBeGreaterThan(tags.GPSInfoIFDPointer);
		expect(thumbnail.blob).toBeInstanceOf(Blob);
		expect(thumbnail.blob.type).toBe('image/jpeg');
		expect(await readBlob(thumbnail.blob)).toEqual(THUMB);
		expect(logSpy).not.toHaveBeenCalled();
	});
});

describe('readFromBinaryFile edge cases', () => {
	const read = bytes => EXIF.readFromBinaryFile(toArrayBuffer(bytes));

	test('rejects data that is not a JPEG', () => {
		expect(read([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0])).toBe(false);
		expect(read([0xFF, 0x00, 0x00, 0x00])).toBe(false);
	});

	test('rejects an invalid marker', () => {
		expect(read([0xFF, 0xD8, 0x00, 0xE1, 0x00, 0x02])).toBe(false);
	});

	test('skips non-APP1 segments and stops at entropy-coded data', () => {
		const sos = segment(0xDA, [1, 1, 0, 0, 0x3F, 0]);
		expect(read([0xFF, 0xD8].concat(app0(), sos, [0x00, 0x00, 0xFF, 0xD9]))).toBe(false);
	});

	test('returns undefined when the segments end without an APP1', () => {
		expect(read([0xFF, 0xD8].concat(app0()))).toBeUndefined();
	});

	test('rejects an APP1 segment that is not Exif', () => {
		expect(read(jpeg(xmpSegment('<x:xmpmeta/>')))).toBe(false);
	});

	test('rejects an invalid TIFF byte order', () => {
		expect(read(jpeg(exifSegment(buildTiff({ byteOrder: 'XX' }))))).toBe(false);
	});

	test('rejects a TIFF header without the 0x002A magic', () => {
		expect(read(jpeg(exifSegment(buildTiff({ magic: 0x2B }))))).toBe(false);
		expect(read(jpeg(exifSegment(buildTiff({ bigEnd: true, magic: 0x2B }))))).toBe(false);
	});

	test('rejects a first IFD offset below 8', () => {
		expect(read(jpeg(exifSegment(buildTiff({ firstIFDOffset: 4 }))))).toBe(false);
	});

	test('returns an empty thumbnail when there is no IFD1', () => {
		const tags = read(jpeg(exifSegment(buildTiff({ ifd0: [{ tag: 0x0112, type: 3, values: 3 }] }))));
		expect(tags).toEqual({ Orientation: 3, thumbnail: {} });
	});

	test('returns an empty thumbnail when the IFD1 offset is past the end of the file', () => {
		const tags = read(jpeg(exifSegment(buildTiff({ ifd0: [{ tag: 0x0112, type: 3, values: 3 }], ifd1Offset: 100000 }))));
		expect(tags).toEqual({ Orientation: 3, thumbnail: {} });
	});

	test('leaves GPSVersionID undefined when it cannot be decoded', () => {
		const tags = read(jpeg(exifSegment(buildTiff({ gps: [{ tag: 0x0000, type: 8, values: 1 }] }))));
		expect(Object.keys(tags)).toContain('GPSVersionID');
		expect(tags.GPSVersionID).toBeUndefined();
	});

	test('maps Exif enum values missing from StringValues to undefined', () => {
		// Documents current behaviour: the raw value (0x02, a reserved Flash value) is lost
		const tags = read(jpeg(exifSegment(buildTiff({ exif: [{ tag: 0x9209, type: 3, values: 0x02 }] }))));
		expect(Object.keys(tags)).toContain('Flash');
		expect(tags.Flash).toBeUndefined();
	});

	describe('IFD1 thumbnail formats', () => {
		const withIfd1 = ifd1 => read(jpeg(exifSegment(buildTiff({ ifd1 }))));

		test('JPEG compression without offset/length tags yields no blob', () => {
			expect(withIfd1([{ tag: 0x0103, type: 3, values: 6 }]).thumbnail).toEqual({ Compression: 6 });
			expect(logSpy).not.toHaveBeenCalled();
		});

		test('TIFF (uncompressed) thumbnails are reported as not implemented', () => {
			expect(withIfd1([{ tag: 0x0103, type: 3, values: 1 }]).thumbnail).toEqual({ Compression: 1 });
			expect(logSpy).toHaveBeenCalledWith('Thumbnail image format is TIFF, which is not implemented.');
		});

		test('unknown compression values are reported', () => {
			expect(withIfd1([{ tag: 0x0103, type: 3, values: 3 }]).thumbnail).toEqual({ Compression: 3 });
			expect(logSpy).toHaveBeenCalledWith("Unknown thumbnail image format '%s'", 3);
		});

		test('RGB thumbnails without a Compression tag are reported as not implemented', () => {
			expect(withIfd1([{ tag: 0x0106, type: 3, values: 2 }]).thumbnail).toEqual({ PhotometricInterpretation: 2 });
			expect(logSpy).toHaveBeenCalledWith('Thumbnail image format is RGB, which is not implemented.');
		});

		test('other IFD1 contents are returned as-is', () => {
			expect(withIfd1([{ tag: 0x0106, type: 3, values: 6 }, { tag: 0x0100, type: 4, values: 160 }]).thumbnail)
				.toEqual({ PhotometricInterpretation: 6, ImageWidth: 160 });
			expect(logSpy).not.toHaveBeenCalled();
		});
	});

	describe('truncated or corrupt data throws', () => {
		test('APP1 cut off before the Exif header', () => {
			expect(() => read([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10, 0x45])).toThrow(RangeError);
			// logged by getStringFromDB and by readEXIFData before rethrowing
			expect(logSpy).toHaveBeenCalledTimes(2);
			expect(logSpy.mock.calls[0][0]).toBeInstanceOf(RangeError);
		});

		test('marker at the very end of the file', () => {
			expect(() => read([0xFF, 0xD8, 0xFF])).toThrow(RangeError);
		});

		test('a standalone EOI marker without a segment length', () => {
			// Documents current behaviour: markers without a length field are not handled
			expect(() => read([0xFF, 0xD8].concat(app0(), [0xFF, 0xD9]))).toThrow(RangeError);
		});

		test.each([
			['rational', 5],
			['multi-value long', 4],
			['multi-value slong', 9],
			['signed rational', 10],
			['multi-value short', 3],
			['multi-value byte', 1],
		])('%s value offset outside the buffer', (label, type) => {
			const tiff = buildTiff({ ifd0: [{ tag: 0x011A, type, count: 6, raw: 0xFFFF }] });
			expect(() => read(jpeg(exifSegment(tiff)))).toThrow(RangeError);
			// readTagValue and readEXIFData both log before rethrowing
			expect(logSpy).toHaveBeenCalledTimes(2);
		});

		test('single signed rational outside the buffer', () => {
			const tiff = buildTiff({ ifd0: [{ tag: 0x011A, type: 10, count: 1, raw: 0xFFFF }] });
			expect(() => read(jpeg(exifSegment(tiff)))).toThrow(RangeError);
		});

		test('ascii value offset outside the buffer', () => {
			const tiff = buildTiff({ ifd0: [{ tag: 0x010F, type: 2, count: 10, raw: 0xFFFF }] });
			expect(() => read(jpeg(exifSegment(tiff)))).toThrow(RangeError);
			// getStringFromDB, readTagValue and readEXIFData each log before rethrowing
			expect(logSpy).toHaveBeenCalledTimes(3);
		});

		test('IFD1 offset inside byteLength but past the end once tiffStart is added', () => {
			// Documents a bug: the bounds check ignores tiffStart, so this throws instead of returning {}
			const opts = { ifd0: [{ tag: 0x0112, type: 3, values: 3 }], ifd1Offset: 0 };
			const probe = jpeg(exifSegment(buildTiff(opts)));
			expect(tiffStartOf(probe)).toBeGreaterThan(2);
			opts.ifd1Offset = probe.length - 2;
			expect(() => read(jpeg(exifSegment(buildTiff(opts))))).toThrow(RangeError);
		});

		test('JPEG thumbnail extending past the end of the buffer', () => {
			const tiff = buildTiff({
				ifd1: [
					{ tag: 0x0103, type: 3, values: 6 },
					{ tag: 0x0201, type: 4, values: 8 },
					{ tag: 0x0202, type: 4, values: 100000 },
				],
			});
			expect(() => read(jpeg(exifSegment(tiff)))).toThrow(RangeError);
		});
	});
});

describe('EXIF.getData', () => {
	const exifJpeg = () => jpeg(app0(), exifSegment(fullTiff(false)));

	describe('data URI images', () => {
		test('parses EXIF and exposes it through getTag/getAllTags', async () => {
			const img = { src: toDataURI(exifJpeg()) };
			const result = await getData(img);
			expect(result).toBe(img);
			expect(EXIF.getTag(img, 'Make')).toBe('Canon Inc.');
			expect(EXIF.getTag(img, 'Flash')).toBe('Flash fired, auto mode');
			const all = EXIF.getAllTags(img);
			expect(all).not.toBe(img.exifdata);
			expect(all).toEqual(img.exifdata);
			expect(all.GPSVersionID).toBe('2.3.0.0');
			expect(img.iptcdata).toEqual({});
			expect(img.xmpdata).toBeUndefined();
			expect(logSpy).not.toHaveBeenCalled();
		});

		test('stores empty objects for a non-JPEG payload', async () => {
			EXIF.enableXmp();
			const img = { src: toDataURI([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'image/png') };
			await getData(img);
			expect(img.exifdata).toEqual({});
			expect(img.iptcdata).toEqual({});
			expect(img.xmpdata).toEqual({});
			expect(EXIF.getAllTags(img)).toEqual({});
			expect(EXIF.pretty(img)).toBe('');
		});

		test('returns false and logs when parsing throws', () => {
			const callback = jest.fn();
			expect(EXIF.getData({ src: toDataURI([0xFF, 0xD8, 0xFF]) }, callback)).toBe(false);
			expect(callback).not.toHaveBeenCalled();
			// logged once by getImageData and once by getData
			expect(logSpy).toHaveBeenCalledTimes(2);
			expect(logSpy.mock.calls[1][0]).toBeInstanceOf(RangeError);
		});

		test('works without a callback', () => {
			const img = { src: toDataURI(exifJpeg()) };
			expect(EXIF.getData(img)).toBe(true);
			expect(img.exifdata.Model).toBe('X1');
		});
	});

	describe('cached data', () => {
		test('invokes the callback immediately when exifdata is already present', () => {
			const img = { exifdata: { Make: 'Cached' }, iptcdata: {} };
			const callback = jest.fn(function () {
				expect(this).toBe(img);
			});
			expect(EXIF.getData(img, callback)).toBe(true);
			expect(callback).toHaveBeenCalledTimes(1);
			expect(EXIF.getData(img)).toBe(true);
			expect(EXIF.getTag(img, 'Make')).toBe('Cached');
		});
	});

	describe('accessors without data', () => {
		test('return empty values', () => {
			const img = {};
			expect(EXIF.getTag(img, 'Make')).toBeUndefined();
			expect(EXIF.getIptcTag(img, 'caption')).toBeUndefined();
			expect(EXIF.getAllTags(img)).toEqual({});
			expect(EXIF.getAllIptcTags(img)).toEqual({});
			expect(EXIF.pretty(img)).toBe('');
		});

		test('an object with neither src nor Blob type is a no-op', () => {
			const callback = jest.fn();
			expect(EXIF.getData({}, callback)).toBe(true);
			expect(callback).not.toHaveBeenCalled();
		});
	});

	describe('HTML image elements', () => {
		test('returns false for an image that has not finished loading', () => {
			const img = new Image();
			img.src = 'http://example.com/photo.jpg';
			expect(img.complete).toBe(false);
			expect(EXIF.getData(img, jest.fn())).toBe(false);
		});

		test('detects HTMLImageElement when Image is not available', () => {
			const OriginalImage = window.Image;
			window.Image = undefined;
			try {
				const img = document.createElement('img');
				img.src = 'http://example.com/photo.jpg';
				expect(EXIF.getData(img, jest.fn())).toBe(false);
			} finally {
				window.Image = OriginalImage;
			}
		});

		test('reads a completed image element', async () => {
			const img = new Image();
			img.src = toDataURI(exifJpeg());
			Object.defineProperty(img, 'complete', { value: true });
			await getData(img);
			expect(EXIF.getTag(img, 'Orientation')).toBe(6);
		});
	});

	describe('remote and object URLs', () => {
		let OriginalXHR;

		beforeEach(() => {
			OriginalXHR = window.XMLHttpRequest;
			FakeXHR.instances = [];
			window.XMLHttpRequest = FakeXHR;
		});

		afterEach(() => {
			window.XMLHttpRequest = OriginalXHR;
		});

		test.each([200, 0])('loads an http URL via XMLHttpRequest (status %i)', status => {
			const img = { src: 'http://example.com/photo.jpg' };
			const callback = jest.fn();
			expect(EXIF.getData(img, callback)).toBe(true);
			expect(FakeXHR.instances).toHaveLength(1);
			const xhr = FakeXHR.instances[0];
			expect(xhr).toMatchObject({ method: 'GET', url: img.src, async: true, responseType: 'arraybuffer', sentBody: null });
			expect(callback).not.toHaveBeenCalled();
			xhr.status = status;
			xhr.response = toArrayBuffer(exifJpeg());
			xhr.onload();
			expect(callback).toHaveBeenCalledTimes(1);
			expect(img.exifdata.Make).toBe('Canon Inc.');
		});

		test('throws from the load handler on a non-200 response', () => {
			const img = { src: 'http://example.com/missing.jpg' };
			const callback = jest.fn();
			const errorCallback = jest.fn();
			EXIF.getData(img, callback, errorCallback);
			const xhr = FakeXHR.instances[0];
			xhr.status = 404;
			let thrown;
			try {
				xhr.onload();
			} catch (err) {
				thrown = err;
			}
			// Documents current behaviour: a string is thrown and errorCallback is never used
			expect(thrown).toBe('Could not load image');
			expect(callback).not.toHaveBeenCalled();
			expect(errorCallback).not.toHaveBeenCalled();
			expect(img.exifdata).toBeUndefined();
		});

		test.each([200, 0])('loads a blob: URL via XMLHttpRequest and FileReader (status %i)', async status => {
			const img = { src: 'blob:http://localhost/1234' };
			const done = getData(img);
			const xhr = FakeXHR.instances[0];
			expect(xhr).toMatchObject({ method: 'GET', url: img.src, async: true, responseType: 'blob' });
			xhr.status = status;
			xhr.response = new Blob([new Uint8Array(exifJpeg())]);
			xhr.onload({});
			await done;
			expect(img.exifdata.Model).toBe('X1');
			expect(img.exifdata.thumbnail.JpegIFByteCount).toBe(THUMB.length);
		});

		test('never calls back when a blob: URL fails to load', async () => {
			const img = { src: 'blob:http://localhost/gone' };
			const callback = jest.fn();
			const errorCallback = jest.fn();
			EXIF.getData(img, callback, errorCallback);
			const xhr = FakeXHR.instances[0];
			xhr.status = 404;
			xhr.onload({});
			await new Promise(resolve => setTimeout(resolve, 20));
			// Documents current behaviour: the failure is silently swallowed
			expect(callback).not.toHaveBeenCalled();
			expect(errorCallback).not.toHaveBeenCalled();
		});
	});

	describe('Blob and File inputs', () => {
		test('reads a Blob with FileReader', async () => {
			const blob = new Blob([new Uint8Array(exifJpeg())], { type: 'image/jpeg' });
			const result = await getData(blob);
			expect(result).toBe(blob);
			expect(EXIF.getTag(blob, 'ExifVersion')).toBe('0230');
		});

		test('reads a File with FileReader', async () => {
			const file = new File([new Uint8Array(exifJpeg())], 'photo.jpg', { type: 'image/jpeg' });
			await getData(file);
			expect(EXIF.getTag(file, 'GPSLatitudeRef')).toBe('N');
		});

		test('reports parse errors through errorCallback', async () => {
			const blob = new Blob([new Uint8Array([0xFF, 0xD8, 0xFF])]);
			const callback = jest.fn();
			const message = await new Promise(resolve => {
				expect(EXIF.getData(blob, callback, resolve)).toBe(true);
			});
			expect(message).toMatch(/offset|bounds/i);
			expect(callback).not.toHaveBeenCalled();
			expect(logSpy).toHaveBeenCalledWith(expect.any(RangeError));
		});
	});
});

describe('EXIF.pretty', () => {
	test('formats strings, numbers, rationals and arrays', async () => {
		const tiff = buildTiff({
			ifd0: [
				{ tag: 0x010F, type: 2, values: 'Canon' },
				{ tag: 0x0112, type: 3, values: 1 },
				{ tag: 0x011A, type: 5, values: [72, 1] },
				{ tag: 0x0102, type: 3, values: [8, 8, 8] },
			],
		});
		const img = { src: toDataURI(jpeg(exifSegment(tiff))) };
		await getData(img);
		// The (empty) thumbnail object has no length, hence "[undefined values]"
		expect(EXIF.pretty(img)).toBe(
			'Make : Canon\r\n' +
			'Orientation : 1\r\n' +
			'XResolution : 72 [72/1]\r\n' +
			'BitsPerSample : [3 values]\r\n' +
			'thumbnail : [undefined values]\r\n'
		);
	});

	test('skips inherited properties', () => {
		const exifdata = Object.create({ Inherited: 'x' });
		exifdata.Own = 'y';
		expect(EXIF.pretty({ exifdata })).toBe('Own : y\r\n');
		expect(EXIF.getAllTags({ exifdata })).toEqual({ Own: 'y' });
		const iptcdata = Object.create({ inherited: 'x' });
		iptcdata.caption = 'c';
		expect(EXIF.getAllIptcTags({ exifdata, iptcdata })).toEqual({ caption: 'c' });
	});
});

describe('IPTC', () => {
	const withIptc = app13 => ({ src: toDataURI(jpeg(app0(), app13, exifSegment(buildTiff({ ifd0: [{ tag: 0x0112, type: 3, values: 1 }] })))) });

	test('reads Photoshop 8BIM IPTC fields and collects repeated fields into arrays', async () => {
		const img = withIptc(iptcSegment([
			iptcRecord(0x00, [0x00, 0x04], 1), // envelope record, ignored
			iptcRecord(0x00, [0x00, 0x04]), // RecordVersion, not mapped
			iptcRecord(0x78, 'A caption'),
			iptcRecord(0x19, 'one'),
			iptcRecord(0x19, 'two'),
			iptcRecord(0x19, 'three'),
			iptcRecord(0x50, 'Jane'),
			iptcRecord(0x50, 'John'),
			iptcRecord(0x55, 'Photographer'),
			iptcRecord(0x6E, 'Credit'),
			iptcRecord(0x74, '(c) 2024'),
			iptcRecord(0x37, '20241209'),
			iptcRecord(0x69, 'Headline'),
			iptcRecord(0x7A, 'Writer'),
			iptcRecord(0x0F, 'Cat'),
		]));
		await getData(img);
		expect(EXIF.getAllIptcTags(img)).toEqual({
			caption: 'A caption',
			keywords: ['one', 'two', 'three'],
			byline: ['Jane', 'John'],
			bylineTitle: 'Photographer',
			credit: 'Credit',
			copyright: '(c) 2024',
			dateCreated: '20241209',
			headline: 'Headline',
			captionWriter: 'Writer',
			category: 'Cat',
		});
		expect(EXIF.getIptcTag(img, 'caption')).toBe('A caption');
		expect(EXIF.getTag(img, 'Orientation')).toBe(1);
	});

	test('handles an odd name header length byte by padding it', async () => {
		// The library reads the byte at +7 as the header length: 1 is padded to 2, so the
		// 16-bit section length follows at +8 and data at +10
		const record = iptcRecord(0x78, 'Odd');
		const img = withIptc(segment(0xED, ascii('8BIM').concat([0x04, 0x04, 0x00, 0x01, 0x00, record.length], record)));
		await getData(img);
		expect(img.iptcdata).toEqual({ caption: 'Odd' });
	});

	test('returns an empty object when there is no IPTC resource', async () => {
		const img = withIptc(segment(0xED, ascii('Photoshop 3.0').concat([0])));
		await getData(img);
		expect(img.iptcdata).toEqual({});
		expect(EXIF.getIptcTag(img, 'caption')).toBeUndefined();
	});

	test('scans byte-by-byte, so record headers inside a value are parsed as fields', async () => {
		// Documents a bug: readIPTCData never skips over a field's data
		const img = withIptc(iptcSegment([iptcRecord(0x78, [0x41].concat(iptcRecord(0x69, 'hi')))]));
		await getData(img);
		expect(img.iptcdata.headline).toBe('hi');
		expect(img.iptcdata.caption).toHaveLength(8);
	});
});

describe('XMP', () => {
	const XMP_BODY = '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Test XMP">' +
		'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
		'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" tiff:Make="Canon">' +
		'<!--note-->' +
		'<dc:subject><rdf:Bag><rdf:li>one</rdf:li><rdf:li>two</rdf:li><rdf:li>three</rdf:li></rdf:Bag></dc:subject>' +
		'</rdf:Description></rdf:RDF></x:xmpmeta>';
	const XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' + XMP_BODY + '<?xpacket end="w"?>';
	const exif = () => exifSegment(buildTiff({ ifd0: [{ tag: 0x0112, type: 3, values: 8 }] }));
	const withXmp = xml => ({ src: toDataURI(jpeg(app0(), exif(), xmpSegment(xml))) });

	test('is not parsed unless enabled', async () => {
		const img = withXmp(XMP);
		await getData(img);
		expect(img.xmpdata).toBeUndefined();
		expect(EXIF.isXmpEnabled).toBe(false);
	});

	test('parses XMP into an object, injecting common namespaces', async () => {
		EXIF.enableXmp();
		expect(EXIF.isXmpEnabled).toBe(true);
		const img = withXmp(XMP);
		await getData(img);
		const xmp = img.xmpdata;
		expect(xmp['xmlns:x']).toBe('adobe:ns:meta/');
		expect(xmp['x:xmptk']).toBe('Test XMP');
		expect(xmp['xmlns:tiff']).toBe('http://ns.adobe.com/tiff/1.0/');
		const meta = xmp['x:xmpmeta'];
		expect(meta['@attributes']['x:xmptk']).toBe('Test XMP');
		const rdf = meta['rdf:RDF'];
		expect(rdf['@attributes']).toEqual({ 'xmlns:rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' });
		expect(rdf['rdf:Description']).toEqual({
			'@attributes': {
				'rdf:about': '',
				'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
				'tiff:Make': 'Canon',
			},
			'#comment': {},
			'dc:subject': {
				'rdf:Bag': {
					'rdf:li': [{ '#text': 'one' }, { '#text': 'two' }, { '#text': 'three' }],
				},
			},
		});
		expect(EXIF.getTag(img, 'Orientation')).toBe(8);
	});

	test('merges an attribute that shares the root element name into an array', async () => {
		EXIF.enableXmp();
		const img = withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmpmeta="attr"><a>1</a></x:xmpmeta><?xpacket end="w"?>');
		await getData(img);
		expect(img.xmpdata['x:xmpmeta']).toEqual(['attr', expect.objectContaining({ a: { '#text': '1' } })]);
	});

	test('returns a parsererror object for malformed XMP', async () => {
		EXIF.enableXmp();
		const img = withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><unclosed></x:xmpmeta><?xpacket end="w"?>');
		await getData(img);
		expect(Object.keys(img.xmpdata)).toEqual(['parsererror']);
		expect(typeof img.xmpdata.parsererror['#text']).toBe('string');
	});

	test('picks up the first "http" anywhere in the file, even inside EXIF', async () => {
		// Documents a bug: an EXIF string containing "http" is mistaken for the XMP segment
		EXIF.enableXmp();
		const tiff = buildTiff({ ifd0: [{ tag: 0x8298, type: 2, values: 'http://example.com/license' }] });
		const img = { src: toDataURI(jpeg(exifSegment(tiff), xmpSegment(XMP))) };
		await getData(img);
		expect(img.exifdata.Copyright).toBe('http://example.com/license');
		expect(img.xmpdata['x:xmpmeta']).toBeUndefined();
		expect(img.xmpdata.parsererror).toBeDefined();
	});

	test('returns an empty object when there is no XMP segment', async () => {
		EXIF.enableXmp();
		const img = { src: toDataURI(jpeg(app0(), exif())) };
		await getData(img);
		expect(img.xmpdata).toEqual({});
	});

	test('returns an empty object when DOMParser is unavailable', async () => {
		EXIF.enableXmp();
		const OriginalDOMParser = window.DOMParser;
		delete window.DOMParser;
		try {
			expect('DOMParser' in window).toBe(false);
			const img = withXmp(XMP);
			await getData(img);
			expect(img.xmpdata).toEqual({});
			expect(img.exifdata.Orientation).toBe(8);
		} finally {
			window.DOMParser = OriginalDOMParser;
		}
	});

	describe('with a stubbed DOMParser', () => {
		let OriginalDOMParser;

		beforeEach(() => {
			EXIF.enableXmp();
			OriginalDOMParser = window.DOMParser;
		});

		afterEach(() => {
			window.DOMParser = OriginalDOMParser;
		});

		const stubDocument = doc => {
			window.DOMParser = class {
				parseFromString() {
					return doc;
				}
			};
		};

		test('falls back to textContent for a document without elements', async () => {
			stubDocument({ children: { length: 0 }, textContent: 'plain text' });
			const img = withXmp(XMP);
			await getData(img);
			expect(img.xmpdata).toBe('plain text');
		});

		test('collects repeated top-level elements into an array', async () => {
			const items = ['1', '2', '3'].map(n => {
				const el = document.createElementNS('urn:test', 't:item');
				el.setAttribute('n', n);
				return el;
			});
			stubDocument({ children: { length: items.length, item: i => items[i] } });
			const img = withXmp(XMP);
			await getData(img);
			expect(img.xmpdata.n).toBe('3');
			expect(img.xmpdata['t:item']).toEqual([
				{ '@attributes': { n: '1' } },
				{ '@attributes': { n: '2' } },
				{ '@attributes': { n: '3' } },
			]);
		});

		test('logs and returns an empty object when conversion throws', async () => {
			stubDocument({
				get children() {
					throw new Error('conversion failed');
				},
			});
			const img = withXmp(XMP);
			await getData(img);
			expect(logSpy).toHaveBeenCalledWith('conversion failed');
			expect(img.xmpdata).toEqual({});
		});
	});
});

describe('AMD support', () => {
	test('registers itself with an AMD loader when define.amd is present', () => {
		const define = jest.fn();
		define.amd = {};
		global.define = define;
		try {
			jest.isolateModules(() => {
				const isolated = require('../remove-bg-tools/exif');
				expect(define).toHaveBeenCalledWith('exif-js', [], expect.any(Function));
				expect(define.mock.calls[0][2]()).toBe(isolated);
				expect(isolated).not.toBe(EXIF);
			});
		} finally {
			delete global.define;
		}
	});
});
