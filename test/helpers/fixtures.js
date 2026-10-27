const fs = require('fs');
const JSZip = require('jszip');
const { createCanvas } = require('canvas');

// Builds a minimal remove.bg-style ZIP: an opaque color.jpg plus an alpha.png mask
// (left half opaque, right half transparent)
async function createRemovebgZipBuffer(width, height) {
	const color = createCanvas(width, height);
	const colorCtx = color.getContext('2d');
	colorCtx.fillStyle = '#ff0000';
	colorCtx.fillRect(0, 0, width, height);

	const alpha = createCanvas(width, height);
	const alphaCtx = alpha.getContext('2d');
	alphaCtx.fillStyle = '#000000';
	alphaCtx.fillRect(0, 0, width, height);
	alphaCtx.fillStyle = '#ffffff';
	alphaCtx.fillRect(0, 0, width / 2, height);

	const zip = new JSZip();
	zip.file('color.jpg', color.toBuffer('image/jpeg'));
	zip.file('alpha.png', alpha.toBuffer('image/png'));
	return zip.generateAsync({ type: 'nodebuffer' });
}

async function createRemovebgZip(zipPath, width, height) {
	fs.writeFileSync(zipPath, await createRemovebgZipBuffer(width, height));
}

module.exports = { createRemovebgZip, createRemovebgZipBuffer };
