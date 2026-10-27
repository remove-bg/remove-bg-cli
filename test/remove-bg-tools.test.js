// Unit tests for the vendored remove-bg-tools module in the default node environment
// (the environment the CLI actually runs in). Browser-only paths are covered in
// remove-bg-tools.jsdom.test.js.
const JSZip = require('jszip');
const { createCanvas, loadImage } = require('canvas');
const { createRemovebgZipBuffer } = require('./helpers/fixtures');
const { ImageResizer, ZipCanvas, BrowserCompatibility } = require('../remove-bg-tools');

function alphaAt(ctx, x, y) {
	return ctx.getImageData(x, y, 1, 1).data[3];
}

async function decodeDataUrl(dataUrl) {
	const img = await loadImage(dataUrl);
	const canvas = createCanvas(img.width, img.height);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0);
	return { img, ctx };
}

// Fails fast (instead of hitting the Jest timeout) when a promise never settles
function settleWithin(promise, ms = 1000) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function recordProgress() {
	const stages = [];
	const progress = jest.fn(p => stages.push(p));
	return { stages, progress };
}

describe('ZipCanvas.fromBinary (as used by the CLI zip2png command)', () => {
	test('composites alpha.png into color.jpg and exports a data URL', async () => {
		const zip = await createRemovebgZipBuffer(8, 4);
		const { stages, progress } = recordProgress();

		const zipCanvas = await ZipCanvas.fromBinary(zip, false, {
			export: { mimeType: 'image/jpg', quality: 0.92 },
			usePsd: false,
			bg_color: false,
			resolutionInfo: false,
		}, progress);

		expect(zipCanvas).toBeInstanceOf(ZipCanvas);
		expect(zipCanvas.blob).toBeUndefined();
		// node-canvas has no toBlob, so export() falls back to toDataURL; it does not know
		// 'image/jpg' and silently produces a PNG, which is what zip2png relies on
		expect(zipCanvas.dataUrl).toMatch(/^data:image\/png;base64,/);
		expect(stages).toEqual([
			{ stage: 'loadzip', percent: 20 },
			{ stage: 'extractzip', percent: 30 },
			{ stage: 'loadimages', percent: 70 },
			{ stage: 'compositing', percent: 80 },
			{ stage: 'exporting', percent: 90 },
		]);

		const { img, ctx } = await decodeDataUrl(zipCanvas.dataUrl);
		expect([img.width, img.height]).toEqual([8, 4]);
		// left half of the mask is white (opaque), right half black (transparent)
		expect(alphaAt(ctx, 0, 0)).toBe(255);
		expect(alphaAt(ctx, 3, 3)).toBe(255);
		expect(alphaAt(ctx, 4, 0)).toBe(0);
		expect(alphaAt(ctx, 7, 3)).toBe(0);
		const [r, g, b] = ctx.getImageData(1, 1, 1, 1).data;
		expect(r).toBeGreaterThan(240);
		expect(g).toBeLessThan(15);
		expect(b).toBeLessThan(15);
	});

	test('the composited canvas keeps the colour pixels and the mask as alpha channel', async () => {
		const zip = await createRemovebgZipBuffer(6, 2);
		const zipCanvas = await ZipCanvas.fromBinary(zip, null, {}, () => {});

		const canvas = zipCanvas.canvas;
		expect([canvas.width, canvas.height]).toEqual([6, 2]);
		const ctx = canvas.getContext('2d');
		expect(alphaAt(ctx, 2, 1)).toBe(255);
		expect(alphaAt(ctx, 3, 1)).toBe(0);
	});

	test('defaults to a PNG export when no export options are given', async () => {
		const zip = await createRemovebgZipBuffer(2, 2);
		const zipCanvas = await ZipCanvas.fromBinary(zip, null, {}, () => {});
		expect(zipCanvas.dataUrl).toMatch(/^data:image\/png;base64,/);
	});

	test('honours image/jpeg export (alpha is dropped by the encoder)', async () => {
		const zip = await createRemovebgZipBuffer(4, 2);
		const zipCanvas = await ZipCanvas.fromBinary(zip, null, { export: { mimeType: 'image/jpeg', quality: 0.5 } }, () => {});
		expect(zipCanvas.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
		const { img, ctx } = await decodeDataUrl(zipCanvas.dataUrl);
		expect([img.width, img.height]).toEqual([4, 2]);
		expect(alphaAt(ctx, 3, 1)).toBe(255);
	});

	test('rejects for data that is not a ZIP', async () => {
		const { stages, progress } = recordProgress();
		await expect(ZipCanvas.fromBinary(Buffer.from('not a zip'), null, {}, progress)).rejects.toThrow(/zip/i);
		expect(stages).toEqual([{ stage: 'loadzip', percent: 20 }]);
	});

	test('rejects when the ZIP does not contain color.jpg', async () => {
		const zip = new JSZip();
		zip.file('alpha.png', Buffer.from('x'));
		const buf = await zip.generateAsync({ type: 'nodebuffer' });
		await expect(ZipCanvas.fromBinary(buf, null, {}, () => {})).rejects.toThrow(TypeError);
	});

	test('rejects with "Failed to load image" when the ZIP entries are not images', async () => {
		const zip = new JSZip();
		zip.file('color.jpg', Buffer.from('garbage'));
		zip.file('alpha.png', Buffer.from('garbage'));
		const buf = await zip.generateAsync({ type: 'nodebuffer' });
		await expect(ZipCanvas.fromBinary(buf, null, {}, () => {})).rejects.toBe('Failed to load image');
	});

	test('works without a progress callback (defaults to a no-op)', async () => {
		const zip = await createRemovebgZipBuffer(2, 2);
		const zipCanvas = await ZipCanvas.fromBinary(zip);
		expect(zipCanvas).toBeInstanceOf(ZipCanvas);
		expect(zipCanvas.dataUrl).toMatch(/^data:image\/png;base64,/);
	});

	test('rejects (rather than throwing) for bad data without a progress callback', async () => {
		await expect(ZipCanvas.fromBinary(Buffer.from('not a zip'))).rejects.toThrow(/zip/i);
	});

	test('passing origData fails in node (no global Blob on node 16, no URL.createObjectURL in require("url"))', async () => {
		const zip = await createRemovebgZipBuffer(2, 2);
		await expect(ZipCanvas.fromBinary(zip, Buffer.from('orig'), {}, () => {}))
			.rejects.toThrow(/Blob is not defined|createObjectURL is not a function/);
	});

	test('usePsd fails in node because it needs document.createElement', async () => {
		const zip = await createRemovebgZipBuffer(2, 2);
		await expect(ZipCanvas.fromBinary(zip, null, { usePsd: true }, () => {}))
			.rejects.toThrow(/document is not defined/);
	});
});

describe('ZipCanvas.loadImage / getCanvas', () => {
	test('loadImage resolves a node-canvas Image for valid image bytes', async () => {
		const src = createCanvas(3, 5).toBuffer('image/png');
		const img = await ZipCanvas.loadImage(src, () => {});
		expect([img.width, img.height]).toEqual([3, 5]);
		expect(img.crossOrigin).toBe('anonymous');
	});

	test('loadImage rejects for invalid image bytes', async () => {
		await expect(ZipCanvas.loadImage(Buffer.from('nope'), () => {})).rejects.toBe('Failed to load image');
	});

	test('loadImage works without a progress callback (defaults to a no-op)', async () => {
		const img = await ZipCanvas.loadImage(createCanvas(2, 3).toBuffer('image/png'));
		expect([img.width, img.height]).toEqual([2, 3]);
	});

	test('getCanvas draws the image onto a same-sized canvas', async () => {
		const src = createCanvas(4, 3);
		const srcCtx = src.getContext('2d');
		srcCtx.fillStyle = '#00ff00';
		srcCtx.fillRect(0, 0, 4, 3);
		const img = await loadImage(src.toBuffer('image/png'));

		const { canvas, ctx } = ZipCanvas.getCanvas(img);
		expect([canvas.width, canvas.height]).toEqual([4, 3]);
		expect(Array.from(ctx.getImageData(2, 1, 1, 1).data)).toEqual([0, 255, 0, 255]);
	});
});

describe('ZipCanvas#export with different canvas capabilities', () => {
	test('uses toBlob when available, forwarding mime type and quality', async () => {
		const blob = { fake: 'blob' };
		const canvas = { toBlob: jest.fn(cb => cb(blob)), toDataURL: jest.fn() };
		const zc = new ZipCanvas(canvas);

		await expect(zc.export({ mimeType: 'image/webp', quality: 0.3 })).resolves.toBeUndefined();

		expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.3);
		expect(canvas.toDataURL).not.toHaveBeenCalled();
		expect(zc.blob).toBe(blob);
		expect(zc.dataUrl).toBeUndefined();
	});

	test('defaults to image/png and undefined quality', async () => {
		const canvas = { toBlob: jest.fn(cb => cb('b')) };
		await new ZipCanvas(canvas).export();
		expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
	});

	test('uses msToBlob (IE10+) when toBlob is missing', async () => {
		const canvas = { msToBlob: jest.fn(() => 'ms-blob'), toDataURL: jest.fn() };
		const zc = new ZipCanvas(canvas);
		await zc.export({ mimeType: 'image/jpeg' });
		expect(zc.blob).toBe('ms-blob');
		expect(canvas.toDataURL).not.toHaveBeenCalled();
	});

	test('falls back to toDataURL when neither toBlob nor msToBlob exist', async () => {
		const canvas = { toDataURL: jest.fn(() => 'data:image/jpeg;base64,AAAA') };
		const zc = new ZipCanvas(canvas);
		await zc.export({ mimeType: 'image/jpeg', quality: 0.8 });
		expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
		expect(zc.dataUrl).toBe('data:image/jpeg;base64,AAAA');
		expect(zc.blob).toBeUndefined();
	});
});

describe('ZipCanvas URL helpers in node', () => {
	test('createURL returns the data URL; revokeURL is a no-op without a blob', () => {
		const zc = new ZipCanvas(null);
		expect(zc.createURL()).toBeUndefined();
		zc.dataUrl = 'data:image/png;base64,AAAA';
		expect(zc.createURL()).toBe('data:image/png;base64,AAAA');
		expect(zc.revokeURL('data:image/png;base64,AAAA')).toBeUndefined();
	});

	test('createURL/revokeURL with a blob throw because the node url module has no object URLs', () => {
		const zc = new ZipCanvas(null);
		zc.blob = { fake: 'blob' };
		expect(() => zc.createURL()).toThrow(/createObjectURL is not a function/);
		expect(() => zc.revokeURL('blob:x')).toThrow(/revokeObjectURL is not a function/);
	});

	test('download does nothing when nothing has been exported', () => {
		expect(new ZipCanvas(null).download('x.png')).toBeUndefined();
	});
});

describe('ImageResizer in node', () => {
	test('supports only jpeg and png', () => {
		const resizer = new ImageResizer();
		expect(resizer.supports({ type: 'image/jpeg' })).toBe(true);
		expect(resizer.supports({ type: 'image/png' })).toBe(true);
		expect(resizer.supports({ type: 'image/gif' })).toBe(false);
		expect(resizer.supports({})).toBe(false);
	});

	test('constructor stores the file', () => {
		const file = { type: 'image/png' };
		expect(new ImageResizer(file).file).toBe(file);
	});

	test('loadEXIF resolves immediately for non-jpeg files', async () => {
		await expect(new ImageResizer().loadEXIF({ type: 'image/png' })).resolves.toBeUndefined();
	});

	test('loadEXIF rejects for jpeg in node because exif.js needs `self`', async () => {
		const log = jest.spyOn(console, 'log').mockImplementation(() => {});
		try {
			await expect(new ImageResizer().loadEXIF({ type: 'image/jpeg' })).rejects.toBe('Error in EXIF data');
			expect(log).toHaveBeenCalledWith(expect.any(ReferenceError));
		} finally {
			log.mockRestore();
		}
	});

	test('loadImageResolutionInfo derives PPI from jpeg EXIF X/YResolution rationals', async () => {
		const file = {
			type: 'image/jpeg',
			exifdata: {
				XResolution: { numerator: 600, denominator: 2 },
				YResolution: { numerator: 150, denominator: 1 },
			},
		};
		await new ImageResizer().loadImageResolutionInfo(file);
		expect(file.resolutionInfo).toEqual({
			horizontalResolutionUnit: 'PPI',
			verticalResolutionUnit: 'PPI',
			horizontalResolution: 300,
			verticalResolution: 150,
		});
	});

	test.each([
		['no exifdata', undefined],
		['missing YResolution', { XResolution: { numerator: 72, denominator: 1 } }],
		['zero denominator', { XResolution: { numerator: 72, denominator: 0 }, YResolution: { numerator: 72, denominator: 1 } }],
	])('loadImageResolutionInfo leaves jpeg resolutionInfo unset with %s', async (_, exifdata) => {
		const file = { type: 'image/jpeg', exifdata };
		await new ImageResizer().loadImageResolutionInfo(file);
		expect(file.resolutionInfo).toBeUndefined();
	});

	test.each(['image/gif', 'image/webp', undefined])('loadImageResolutionInfo resolves without resolutionInfo for type %p', async (type) => {
		const file = { type };
		await expect(settleWithin(new ImageResizer().loadImageResolutionInfo(file))).resolves.toBeUndefined();
		expect(file.resolutionInfo).toBeUndefined();
	});

	test('BUG: loadImage throws in node because require("url") has no createObjectURL', async () => {
		await expect(new ImageResizer({ type: 'image/png' }).loadImage()).rejects.toThrow(/createObjectURL is not a function/);
	});

	test('unloadImage is a no-op when no URL is set', () => {
		const resizer = new ImageResizer();
		resizer.image = 'img';
		resizer.unloadImage();
		expect(resizer.image).toBe('img');
	});
});

describe('BrowserCompatibility.supportsNativeExif', () => {
	const hadNavigator = Object.prototype.hasOwnProperty.call(global, 'navigator');
	const originalNavigator = global.navigator;

	function withNavigator(userAgent, appVersion = '5.0 (X11)', appName = 'Netscape') {
		Object.defineProperty(global, 'navigator', {
			value: { userAgent, appVersion, appName },
			configurable: true,
			writable: true,
		});
	}

	afterEach(() => {
		if (hadNavigator) {
			Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true, writable: true });
		} else {
			delete global.navigator;
		}
	});

	test.each([
		['Chrome 80', false, 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.163 Safari/537.36'],
		['Chrome 81', true, 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.92 Safari/537.36'],
		['Chrome 120', true, 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'],
		['Firefox 76', false, 'Mozilla/5.0 (Windows NT 10.0; rv:76.0) Gecko/20100101 Firefox/76.0'],
		['Firefox 77', true, 'Mozilla/5.0 (Windows NT 10.0; rv:77.0) Gecko/20100101 Firefox/77.0'],
		['Safari with Version', false, 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15'],
		['Safari without Version', false, 'Mozilla/5.0 (Macintosh) AppleWebKit/533.1 (KHTML, like Gecko) Safari/533.1'],
		['Opera with Version', false, 'Opera/9.80 (Windows NT 6.0) Presto/2.12.388 Version/12.14'],
		['Opera without Version', false, 'Opera/9.80 (Windows NT 6.0)'],
		['MSIE', false, 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1)'],
		['other name/version', false, 'Mozilla/5.0 (X11) SomeBrowser/99.1'],
		['jsdom', false, 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/16.7.0'],
	])('%s -> %p', (_, expected, userAgent) => {
		withNavigator(userAgent);
		expect(BrowserCompatibility.supportsNativeExif(userAgent)).toBe(expected);
	});

	test('falls back to navigator.appVersion when the parsed version is not numeric', () => {
		withNavigator('Mozilla/5.0 (X11) Chrome/unknown', '90.0 (X11)');
		expect(BrowserCompatibility.supportsNativeExif()).toBe(true);
		withNavigator('Mozilla/5.0 (X11) Chrome/unknown', '70.0 (X11)');
		expect(BrowserCompatibility.supportsNativeExif()).toBe(false);
	});

	test('uses navigator.appName when the trailing token has no letters', () => {
		withNavigator('Mozilla/5.0 (X11) 1234/99', '5.0', 'Chrome');
		expect(BrowserCompatibility.supportsNativeExif()).toBe(true);
	});

	test('uses navigator.appName and appVersion when the UA has no trailing name/version', () => {
		withNavigator('Mozilla/5.0 (X11) Something', '85.0', 'Chrome');
		expect(BrowserCompatibility.supportsNativeExif()).toBe(true);
		withNavigator('Mozilla/5.0 (X11) Something', '85.0', 'Netscape');
		expect(BrowserCompatibility.supportsNativeExif()).toBe(false);
	});

	test.each([
		// the appVersion fallback must not be used: it would give the opposite answer
		['Chromium 90', true, 'Mozilla/5.0 (X11; Linux x86_64) Chromium/90.0.4430.212', '5.0 (X11)'],
		['Chromium 80', false, 'Mozilla/5.0 (X11; Linux x86_64) Chromium/80.0.3987.163', '90.0 (X11)'],
	])('reads the version after the "Chromium" token: %s -> %p', (_, expected, userAgent, appVersion) => {
		withNavigator(userAgent, appVersion);
		expect(BrowserCompatibility.supportsNativeExif()).toBe(expected);
	});

	test('the userAgent argument takes precedence over navigator.userAgent', () => {
		withNavigator('Mozilla/5.0 (Windows NT 10.0; rv:10.0) Gecko/20100101 Firefox/10.0');
		const chrome90 = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0 Safari/537.36';
		expect(BrowserCompatibility.supportsNativeExif(chrome90)).toBe(true);
		expect(BrowserCompatibility.supportsNativeExif()).toBe(false);
	});

	test('works with a userAgent argument when there is no global navigator', () => {
		delete global.navigator;
		expect(BrowserCompatibility.supportsNativeExif('Mozilla/5.0 (X11; rv:90.0) Gecko/20100101 Firefox/90.0')).toBe(true);
		expect(BrowserCompatibility.supportsNativeExif('Mozilla/5.0 (X11) Chrome/80.0')).toBe(false);
		// non-numeric version: the appVersion fallback has no navigator to read from
		expect(BrowserCompatibility.supportsNativeExif('Mozilla/5.0 (X11) Chrome/unknown')).toBe(false);
		expect(BrowserCompatibility.supportsNativeExif('Mozilla/5.0 (X11) 1234/99')).toBe(false);
	});

	test('returns false when there is neither a userAgent argument nor a global navigator', () => {
		delete global.navigator;
		expect(BrowserCompatibility.supportsNativeExif()).toBe(false);
	});

	test('returns false for the plain node navigator ("Node.js/<version>")', () => {
		withNavigator('Node.js/24');
		expect(BrowserCompatibility.supportsNativeExif()).toBe(false);
	});
});

describe('BrowserCompatibility.decoderAppliesExifOrientation', () => {
	const realCanvas = require('canvas');

	// Loads a fresh copy of the module (fresh probe cache) whose `Image` is FakeImage
	function loadWithImage(FakeImage) {
		let mod;
		jest.isolateModules(() => {
			jest.doMock('canvas', () => ({ ...realCanvas, Image: FakeImage }));
			mod = require('../remove-bg-tools');
		});
		jest.dontMock('canvas');
		return mod.BrowserCompatibility;
	}

	function fakeImage(onSrc) {
		return class FakeImage {
			set src(value) {
				this.loadedSrc = value;
				onSrc(this);
			}
		};
	}

	test('resolves true under node-canvas 3, which applies the EXIF orientation itself', async () => {
		await expect(settleWithin(BrowserCompatibility.decoderAppliesExifOrientation())).resolves.toBe(true);
	});

	test('the probe result is cached', () => {
		const first = BrowserCompatibility.decoderAppliesExifOrientation();
		expect(first).toBeInstanceOf(Promise);
		expect(BrowserCompatibility.decoderAppliesExifOrientation()).toBe(first);
	});

	test('the probe is a 2x1 JPEG that EXIF Orientation 6 turns into 1x2', async () => {
		let src;
		const BC = loadWithImage(fakeImage(img => {
			src = img.loadedSrc;
			img.width = 1;
			img.height = 2;
			img.onload();
		}));
		await BC.decoderAppliesExifOrientation();

		expect(src).toMatch(/^data:image\/jpeg;base64,/);
		const jpeg = Buffer.from(src.split(',')[1], 'base64');
		const rotated = await loadImage(jpeg);
		expect([rotated.width, rotated.height]).toEqual([1, 2]);
		// the first segment after SOI is the EXIF APP1; without it the image is 2x1
		expect(jpeg.readUInt16BE(2)).toBe(0xffe1);
		expect(jpeg.toString('binary', 6, 12)).toBe('Exif\0\0');
		const app1End = 4 + jpeg.readUInt16BE(4);
		const plain = await loadImage(Buffer.concat([jpeg.subarray(0, 2), jpeg.subarray(app1End)]));
		expect([plain.width, plain.height]).toEqual([2, 1]);
	});

	test('resolves false when the probe comes out unrotated (decoder ignores EXIF)', async () => {
		let created = 0;
		const BC = loadWithImage(fakeImage(img => {
			created++;
			img.width = 2;
			img.height = 1;
			img.onload();
		}));
		await expect(settleWithin(BC.decoderAppliesExifOrientation())).resolves.toBe(false);
		await expect(BC.decoderAppliesExifOrientation()).resolves.toBe(false);
		expect(created).toBe(1);
	});

	test('assumes true (every current browser applies EXIF orientation) when the probe fails to load', async () => {
		const BC = loadWithImage(fakeImage(img => img.onerror(new Error('blocked by CSP'))));
		await expect(settleWithin(BC.decoderAppliesExifOrientation())).resolves.toBe(true);
	});
});
