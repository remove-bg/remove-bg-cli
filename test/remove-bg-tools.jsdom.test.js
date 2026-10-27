/**
 * @jest-environment jsdom
 */
// Browser-oriented paths of the vendored remove-bg-tools module. jsdom provides document,
// Blob/File/FileReader, atob and <canvas> (backed by node-canvas). The module does
// `const URL = require('url')`, and Node's url module has no object URLs, so it is mocked
// here: createObjectURL turns the recorded bytes of a Blob into a data: URL that
// node-canvas' Image can load.
const { loadImage, createCanvas } = require('canvas');
const { readPsd } = require('ag-psd');
const { writePngDpi } = require('png-dpi-reader-writer');
const { createRemovebgZipBuffer } = require('./helpers/fixtures');

// Record Blob/File contents so the URL mock can create data: URLs synchronously
const blobBytes = new WeakMap();
function toBuffer(part) {
	if (typeof part === 'string') return Buffer.from(part);
	if (part instanceof ArrayBuffer) return Buffer.from(part);
	if (ArrayBuffer.isView(part)) return Buffer.from(part.buffer, part.byteOffset, part.byteLength);
	if (blobBytes.has(part)) return blobBytes.get(part);
	throw new Error('Unsupported blob part');
}
const NativeBlob = window.Blob;
const NativeFile = window.File;
class RecordingBlob extends NativeBlob {
	constructor(parts = [], opts) {
		super(parts, opts);
		blobBytes.set(this, Buffer.concat(parts.map(toBuffer)));
	}
}
class RecordingFile extends NativeFile {
	constructor(parts, name, opts) {
		super(parts, name, opts);
		blobBytes.set(this, Buffer.concat(parts.map(toBuffer)));
	}
}
window.Blob = RecordingBlob;
window.File = RecordingFile;

const mockUrl = {
	createObjectURL: jest.fn(blob => {
		const bytes = blobBytes.get(blob);
		if (!bytes) throw new Error('createObjectURL mock: unknown blob');
		return `data:${blob.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
	}),
	revokeObjectURL: jest.fn(),
};
jest.doMock('url', () => ({ ...jest.requireActual('url'), ...mockUrl }));
const { ImageResizer, ZipCanvas } = require('../remove-bg-tools');

const CHROME_90 = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36';
const defaultUserAgent = navigator.userAgent;
function setUserAgent(value) {
	Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function readBlob(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(Buffer.from(reader.result));
		reader.onerror = reject;
		reader.readAsArrayBuffer(blob);
	});
}

async function decode(bytes) {
	const img = await loadImage(bytes);
	const canvas = createCanvas(img.width, img.height);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0);
	return { width: img.width, height: img.height, px: (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data) };
}

function expectColor(actual, expected, tolerance = 20) {
	expected.forEach((v, i) => expect(Math.abs(actual[i] - v)).toBeLessThanOrEqual(tolerance));
}

// 4x2 image: left half red, right half blue (makes rotation/flip observable)
function twoToneCanvas(width = 4, height = 2) {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#ff0000';
	ctx.fillRect(0, 0, width / 2, height);
	ctx.fillStyle = '#0000ff';
	ctx.fillRect(width / 2, 0, width / 2, height);
	return canvas;
}

// Splices a little-endian TIFF/EXIF APP1 segment (Orientation, X/YResolution) after the JPEG SOI
function withExif(jpeg, { orientation = 1, xRes = [72, 1], yRes = [72, 1], firstIfdOffset = 8 } = {}) {
	const tiff = Buffer.alloc(66);
	tiff.write('II', 0, 'ascii');
	tiff.writeUInt16LE(0x2a, 2);
	tiff.writeUInt32LE(firstIfdOffset, 4);
	tiff.writeUInt16LE(3, 8);
	const entry = (i, tag, type, value) => {
		const o = 10 + i * 12;
		tiff.writeUInt16LE(tag, o);
		tiff.writeUInt16LE(type, o + 2);
		tiff.writeUInt32LE(1, o + 4);
		if (type === 3) tiff.writeUInt16LE(value, o + 8);
		else tiff.writeUInt32LE(value, o + 8);
	};
	entry(0, 0x0112, 3, orientation);
	entry(1, 0x011a, 5, 50);
	entry(2, 0x011b, 5, 58);
	tiff.writeUInt32LE(0, 46); // no next IFD
	tiff.writeUInt32LE(xRes[0], 50);
	tiff.writeUInt32LE(xRes[1], 54);
	tiff.writeUInt32LE(yRes[0], 58);
	tiff.writeUInt32LE(yRes[1], 62);
	const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
	const header = Buffer.from([0xff, 0xe1, 0, 0]);
	header.writeUInt16BE(payload.length + 2, 2);
	return Buffer.concat([jpeg.slice(0, 2), header, payload, jpeg.slice(2)]);
}

function jpegFile(buf, name = 'photo.jpg') {
	return new File([buf], name, { type: 'image/jpeg' });
}

function pngFile(buf, name = 'photo.png') {
	return new File([buf], name, { type: 'image/png' });
}

function isPending(promise, ms = 50) {
	return Promise.race([promise.then(() => false, () => false), new Promise(r => setTimeout(() => r(true), ms))]);
}

beforeEach(() => {
	mockUrl.createObjectURL.mockClear();
	mockUrl.revokeObjectURL.mockClear();
});

afterEach(() => {
	setUserAgent(defaultUserAgent);
	jest.restoreAllMocks();
});

describe('ImageResizer#reduce', () => {
	test('jpeg in a browser without native EXIF support is rotated by its EXIF orientation', async () => {
		// default jsdom UA -> supportsNativeExif() === false -> canvas-exif-orientation path
		const jpeg = withExif(twoToneCanvas().toBuffer('image/jpeg', { quality: 1 }), {
			orientation: 6,
			xRes: [300, 1],
			yRes: [600, 2],
		});
		const file = jpegFile(jpeg);
		const resizer = new ImageResizer(file);

		const result = await resizer.reduce();

		expect(file.exifdata.Orientation).toBe(6);
		expect(result.resolutionInfo).toEqual({
			horizontalResolutionUnit: 'PPI',
			verticalResolutionUnit: 'PPI',
			horizontalResolution: 300,
			verticalResolution: 300,
		});
		expect(result.blob.type).toBe('image/jpeg');
		const out = await decode(await readBlob(result.blob));
		// orientation 6 = rotate 90deg clockwise: 4x2 becomes 2x4, red (left) ends up on top
		expect([out.width, out.height]).toEqual([2, 4]);
		expectColor(out.px(0, 0), [255, 0, 0, 255]);
		expectColor(out.px(1, 3), [0, 0, 255, 255]);
		// the object URL is released and the image dropped afterwards
		expect(mockUrl.createObjectURL).toHaveBeenCalledWith(file);
		expect(mockUrl.revokeObjectURL).toHaveBeenCalledWith(mockUrl.createObjectURL.mock.results[0].value);
		expect(resizer.url).toBeNull();
		expect(resizer.image).toBeNull();
	});

	test('jpeg in a browser with native EXIF support (Chrome 90) is not rotated again', async () => {
		setUserAgent(CHROME_90);
		const jpeg = withExif(twoToneCanvas().toBuffer('image/jpeg', { quality: 1 }), { orientation: 6 });
		const result = await new ImageResizer(jpegFile(jpeg)).reduce();

		const out = await decode(await readBlob(result.blob));
		expect([out.width, out.height]).toEqual([4, 2]);
		expectColor(out.px(0, 0), [255, 0, 0, 255]);
		expectColor(out.px(3, 1), [0, 0, 255, 255]);
		expect(result.resolutionInfo).toEqual(expect.objectContaining({ horizontalResolution: 72, verticalResolution: 72 }));
	});

	test.each([
		['out of range (9)', 9],
		['zero', 0],
	])('jpeg with an %s EXIF orientation is treated as orientation 1', async (_, orientation) => {
		const jpeg = withExif(twoToneCanvas().toBuffer('image/jpeg', { quality: 1 }), { orientation });
		const result = await new ImageResizer(jpegFile(jpeg)).reduce();
		const out = await decode(await readBlob(result.blob));
		expect([out.width, out.height]).toEqual([4, 2]);
		expectColor(out.px(0, 0), [255, 0, 0, 255]);
	});

	test('jpeg without EXIF keeps its size and has no resolutionInfo', async () => {
		const file = jpegFile(twoToneCanvas(6, 3).toBuffer('image/jpeg'));
		const result = await new ImageResizer(file).reduce();
		expect(file.exifdata).toEqual({});
		expect(result.resolutionInfo).toBeUndefined();
		const out = await decode(await readBlob(result.blob));
		expect([out.width, out.height]).toEqual([6, 3]);
	});

	test('png is flattened onto white and re-encoded as jpeg, reading DPI from pHYs', async () => {
		const canvas = createCanvas(4, 2);
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = '#00ff00';
		ctx.fillRect(0, 0, 2, 2); // right half stays transparent
		const png = Buffer.from(writePngDpi(canvas.toBuffer('image/png'), 144));
		const file = pngFile(png);

		const result = await new ImageResizer(file).reduce();

		expect(file.exifdata).toBeUndefined();
		expect(result.resolutionInfo).toEqual({
			horizontalResolutionUnit: 'PPI',
			verticalResolutionUnit: 'PPI',
			horizontalResolution: 144,
			verticalResolution: 144,
		});
		expect(result.blob.type).toBe('image/jpeg');
		const out = await decode(await readBlob(result.blob));
		expect([out.width, out.height]).toEqual([4, 2]);
		expectColor(out.px(0, 0), [0, 255, 0, 255]);
		expectColor(out.px(3, 1), [255, 255, 255, 255]);
	});

	test('png without pHYs has no resolutionInfo', async () => {
		const result = await new ImageResizer(pngFile(twoToneCanvas().toBuffer('image/png'))).reduce();
		expect(result.resolutionInfo).toBeUndefined();
	});

	test('rejects with the parser error when the EXIF block is corrupt', async () => {
		const log = jest.spyOn(console, 'log').mockImplementation(() => {});
		const jpeg = withExif(twoToneCanvas().toBuffer('image/jpeg'), { firstIfdOffset: 0xffffff });
		await expect(new ImageResizer(jpegFile(jpeg)).reduce()).rejects.toMatch(/outside the bounds/);
		expect(log).toHaveBeenCalledWith(expect.any(RangeError));
	});

	test('rejects when the image cannot be decoded', async () => {
		const resizer = new ImageResizer(pngFile(Buffer.from('not a png')));
		// parsePngFormat tolerates garbage; node-canvas fails to decode it
		await expect(resizer.reduce()).rejects.toThrow(/Unsupported image type/);
		expect(mockUrl.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(resizer.url).toBeNull();
	});

	test('BUG: never settles for file types other than jpeg/png', async () => {
		const file = new File([Buffer.from('GIF89a')], 'anim.gif', { type: 'image/gif' });
		// loadImageResolutionInfo only resolves for jpeg/png, so reduce() hangs forever
		await expect(isPending(new ImageResizer(file).reduce())).resolves.toBe(true);
	});
});

describe('ImageResizer#loadImage / #getBlob', () => {
	test('loadImage loads the file through an object URL', async () => {
		const file = pngFile(twoToneCanvas(5, 3).toBuffer('image/png'));
		const resizer = new ImageResizer(file);
		await resizer.loadImage();
		expect([resizer.image.width, resizer.image.height]).toEqual([5, 3]);
		expect(resizer.image.crossOrigin).toBe('anonymous');
		expect(resizer.url).toMatch(/^data:image\/png;base64,/);

		resizer.unloadImage();
		expect(mockUrl.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(resizer.url).toBeNull();
		expect(resizer.image).toBeNull();
	});

	test('BUG: loadImage calls an undefined global unloadImage() when a URL is already set', async () => {
		const resizer = new ImageResizer(pngFile(twoToneCanvas().toBuffer('image/png')));
		await resizer.loadImage();
		// expected: the previous URL is revoked and the image reloaded
		await expect(resizer.loadImage()).rejects.toThrow(/unloadImage is not defined/);
	});

	test('getBlob downscales images above 25 megapixels, keeping the aspect ratio', async () => {
		const ctx = { fillRect: jest.fn(), drawImage: jest.fn(), fillStyle: null };
		const fakeCanvas = {
			getContext: jest.fn(() => ctx),
			toBlob: jest.fn(cb => cb('fake-blob')),
		};
		const createElement = document.createElement.bind(document);
		jest.spyOn(document, 'createElement').mockImplementation(tag => (tag === 'canvas' ? fakeCanvas : createElement(tag)));

		const resizer = new ImageResizer({ type: 'image/png', resolutionInfo: { horizontalResolution: 1 } });
		resizer.image = { width: 10000, height: 5000 }; // 50 MP, nothing is allocated

		const result = await resizer.getBlob();

		expect(result).toEqual({ blob: 'fake-blob', resolutionInfo: { horizontalResolution: 1 } });
		expect([fakeCanvas.width, fakeCanvas.height]).toEqual([7071, 3536]);
		expect(ctx.fillStyle).toBe('#ffffff');
		expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 7071, 3536);
		expect(ctx.drawImage).toHaveBeenCalledWith(resizer.image, 0, 0, 7071, 3536);
		expect(fakeCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
	});

	test('getBlob keeps images at exactly 25 megapixels', async () => {
		const fakeCanvas = { getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: cb => cb('b') };
		const createElement = document.createElement.bind(document);
		jest.spyOn(document, 'createElement').mockImplementation(tag => (tag === 'canvas' ? fakeCanvas : createElement(tag)));

		const resizer = new ImageResizer({ type: 'image/png' });
		resizer.image = { width: 5000, height: 5000 };
		await resizer.getBlob();
		expect([fakeCanvas.width, fakeCanvas.height]).toEqual([5000, 5000]);
	});
});

describe('ZipCanvas.fromBinary in the browser', () => {
	test('usePsd builds a layered PSD with background, hidden original, mask and resolution', async () => {
		const zip = await createRemovebgZipBuffer(8, 4);
		const orig = createCanvas(16, 8);
		const origCtx = orig.getContext('2d');
		origCtx.fillStyle = '#00ff00';
		origCtx.fillRect(0, 0, 16, 8);
		const resolutionInfo = {
			horizontalResolution: 300,
			horizontalResolutionUnit: 'PPI',
			widthUnit: 'Inches',
			verticalResolution: 300,
			verticalResolutionUnit: 'PPI',
			heightUnit: 'Inches',
		};
		const stages = [];

		const result = await ZipCanvas.fromBinary(zip, orig.toBuffer('image/png'), {
			usePsd: true,
			bg_color: '#0000ff',
			resolutionInfo,
		}, p => stages.push(p.stage));

		expect(Object.keys(result)).toEqual(['blob']);
		expect(result.blob).toBeInstanceOf(Blob);
		expect(stages).toEqual(['loadzip', 'extractzip', 'loadimages', 'compositing', 'exporting']);
		// the original is loaded through a temporary object URL that is revoked again
		expect(mockUrl.createObjectURL).toHaveBeenCalledTimes(1);
		expect(mockUrl.revokeObjectURL).toHaveBeenCalledWith(mockUrl.createObjectURL.mock.results[0].value);

		const psd = readPsd(await readBlob(result.blob));
		expect([psd.width, psd.height]).toEqual([8, 4]);
		expect(psd.imageResources.resolutionInfo).toEqual(expect.objectContaining({
			horizontalResolution: 300,
			verticalResolution: 300,
		}));
		expect(psd.children.map(l => l.name)).toEqual([
			'remove.bg - Original Image',
			'remove.bg - Background',
			'remove.bg',
		]);
		const [origLayer, bgLayer, cutout] = psd.children;
		expect(origLayer.hidden).toBe(true);
		expect(bgLayer.hidden).toBeFalsy();

		const px = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
		// original is scaled down to the cutout size
		expect([origLayer.canvas.width, origLayer.canvas.height]).toEqual([8, 4]);
		expectColor(px(origLayer.canvas, 7, 3), [0, 255, 0, 255]);
		expectColor(px(bgLayer.canvas, 5, 2), [0, 0, 255, 255]);
		// the cutout layer is the opaque colour image; transparency lives in the mask
		expectColor(px(cutout.canvas, 6, 2), [255, 0, 0, 255]);
		expect(cutout.mask).toBeDefined();
		const mask = cutout.mask.canvas;
		expect(px(mask, 0, 0)[0]).toBeGreaterThan(240);
		expect(px(mask, mask.width - 1, 0)[0]).toBeLessThan(15);
		// composite preview: red cutout over the blue background colour
		expectColor(px(psd.canvas, 1, 1), [255, 0, 0, 255]);
		expectColor(px(psd.canvas, 6, 1), [0, 0, 255, 255]);
	});

	test('usePsd without bg_color, original or resolution has a single transparent-preview layer', async () => {
		const zip = await createRemovebgZipBuffer(4, 2);
		const result = await ZipCanvas.fromBinary(zip, null, { usePsd: true }, () => {});
		const psd = readPsd(await readBlob(result.blob));
		expect(psd.children.map(l => l.name)).toEqual(['remove.bg']);
		expect(psd.imageResources).toBeUndefined();
		expect(mockUrl.createObjectURL).not.toHaveBeenCalled();
	});

	test('without usePsd the original is loaded and released but not used', async () => {
		const zip = await createRemovebgZipBuffer(4, 2);
		const orig = createCanvas(4, 2).toBuffer('image/png');
		const zipCanvas = await ZipCanvas.fromBinary(zip, orig, {}, () => {});
		expect(zipCanvas).toBeInstanceOf(ZipCanvas);
		expect(zipCanvas.dataUrl).toMatch(/^data:image\/png;base64,/);
		expect(mockUrl.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
		expect(mockUrl.revokeObjectURL).toHaveBeenCalledTimes(1);
	});
});

describe('ZipCanvas.fromUrl', () => {
	const NativeXHR = window.XMLHttpRequest;
	let requests;

	class FakeXHR {
		constructor() {
			this.listeners = {};
			requests.push(this);
		}
		addEventListener(type, fn) {
			this.listeners[type] = fn;
		}
		open(method, url) {
			this.method = method;
			this.url = url;
		}
		send() {
			this.sent = true;
		}
		emit(type, event = {}) {
			this.listeners[type](event);
		}
	}

	beforeEach(() => {
		requests = [];
		window.XMLHttpRequest = FakeXHR;
	});

	afterEach(() => {
		window.XMLHttpRequest = NativeXHR;
	});

	test('downloads the ZIP as arraybuffer, reports progress and composites it', async () => {
		const zip = await createRemovebgZipBuffer(4, 2);
		const stages = [];
		const promise = ZipCanvas.fromUrl('https://example.com/result.zip', {}, p => stages.push(p));

		const [xhr] = requests;
		expect(xhr).toMatchObject({ method: 'GET', url: 'https://example.com/result.zip', responseType: 'arraybuffer', sent: true });
		xhr.emit('progress', { lengthComputable: true, loaded: 50, total: 100 });
		xhr.emit('progress', { lengthComputable: false });
		// like a real XHR, respond with an ArrayBuffer from this realm (Buffer#buffer is from node's)
		xhr.response = new ArrayBuffer(zip.length);
		new Uint8Array(xhr.response).set(zip);
		xhr.emit('load');

		const zipCanvas = await promise;
		expect(stages).toEqual([
			{ stage: 'download', percent: 10 },
			{ stage: 'download', percent: 15 },
			{ stage: 'loadzip', percent: 20 },
			{ stage: 'extractzip', percent: 30 },
			{ stage: 'loadimages', percent: 70 },
			{ stage: 'compositing', percent: 80 },
			{ stage: 'exporting', percent: 90 },
		]);
		const out = await decode(zipCanvas.dataUrl);
		expect([out.width, out.height]).toEqual([4, 2]);
		expect(out.px(0, 0)[3]).toBe(255);
		expect(out.px(3, 0)[3]).toBe(0);
	});

	test('rejects with the XHR error event', async () => {
		const promise = ZipCanvas.fromUrl('https://example.com/x.zip', {}, () => {});
		const errorEvent = { type: 'error' };
		requests[0].emit('error', errorEvent);
		await expect(promise).rejects.toBe(errorEvent);
	});

	test('BUG: omitting the progress callback throws (default `noop` is undefined)', () => {
		expect(() => ZipCanvas.fromUrl('https://example.com/x.zip')).toThrow(/noop is not defined/);
	});
});

describe('ZipCanvas#download / #createURL / #revokeURL', () => {
	test('download with a data URL clicks a temporary download link', () => {
		const clicked = [];
		jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
			clicked.push(this);
		});
		const zc = new ZipCanvas(null);
		zc.dataUrl = 'data:image/png;base64,AAAA';

		zc.download('cutout.png');

		expect(clicked).toHaveLength(1);
		const [link] = clicked;
		expect(link.href).toBe('data:image/png;base64,AAAA');
		expect(link.target).toBe('_blank');
		expect(link.download).toBe('cutout.png');
		expect(link.innerText).toBe('Download');
	});

	test('BUG: download with a blob calls an undefined saveAs()', () => {
		const zc = new ZipCanvas(null);
		zc.blob = new Blob(['x']);
		expect(() => zc.download('cutout.png')).toThrow(/saveAs is not defined/);
	});

	test('createURL/revokeURL use object URLs for blobs', () => {
		const zc = new ZipCanvas(null);
		zc.blob = new Blob(['hi'], { type: 'text/plain' });
		const url = zc.createURL();
		expect(url).toBe('data:text/plain;base64,aGk=');
		expect(mockUrl.createObjectURL).toHaveBeenCalledWith(zc.blob);
		zc.revokeURL(url);
		expect(mockUrl.revokeObjectURL).toHaveBeenCalledWith(url);
	});

	test('export of a real jsdom canvas goes through toBlob', async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 3;
		canvas.height = 2;
		const zc = new ZipCanvas(canvas);
		await zc.export({ mimeType: 'image/jpeg', quality: 0.9 });
		expect(zc.dataUrl).toBeUndefined();
		expect(zc.blob.type).toBe('image/jpeg');
		const out = await decode(await readBlob(zc.blob));
		expect([out.width, out.height]).toEqual([3, 2]);
	});
});

describe('ZipCanvas.shrinkImage / dataURLtoFile', () => {
	test('BUG: shrinkImage never settles because node-canvas Image#src is empty for data: URLs', async () => {
		const entry = { file: pngFile(twoToneCanvas(8, 4).toBuffer('image/png'), 'input.png') };
		const originalFile = entry.file;

		// expected: resolves with entry.width/height 4x2 and a halved PNG File; actually
		// dataURLtoFile('') throws inside the nested onload, so the promise stays pending
		await expect(isPending(ZipCanvas.shrinkImage(entry, 123))).resolves.toBe(true);
		expect(entry.file).toBe(originalFile);
		expect(entry.width).toBeUndefined();
	});

	test('dataURLtoFile decodes base64 data URLs into a typed File', async () => {
		const file = ZipCanvas.dataURLtoFile('data:text/plain;base64,aGVsbG8=', 'hello.txt');
		expect(file).toBeInstanceOf(File);
		expect(file.name).toBe('hello.txt');
		expect(file.type).toBe('text/plain');
		expect((await readBlob(file)).toString()).toBe('hello');
	});

	test('dataURLtoFile throws for data URLs without a mime type', () => {
		expect(() => ZipCanvas.dataURLtoFile('data:,hello', 'x')).toThrow(TypeError);
	});
});
