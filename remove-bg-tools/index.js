const EXIF = require('./exif');
const CanvasExifOrientation = require('canvas-exif-orientation');
const JSZip = require('jszip');
const { writePsdBuffer } = require('ag-psd');
const { parsePngFormat } = require('png-dpi-reader-writer');
const fs = require('fs');
const { Image, createCanvas } = require('canvas');

class ImageResizer {
  constructor(file) {
    this.file = file;
  }

  supports(file) {
    return file.type == "image/jpeg" || file.type == "image/png";
  }

  reduce() {
    return new Promise((resolve, reject) => {
      this.loadEXIF(this.file).then(() => {
        this.loadImageResolutionInfo(this.file).then(() => {
          this.loadImage().then(() => {
            this.getBlob().then(resolve).catch(reject);
          }).catch(reject).finally(() => {
            this.unloadImage();
          });
        }).catch(reject);
      }).catch(reject);
    });
  }

  loadEXIF(file) {
    return new Promise((resolve, reject) => {
      if (file.type != "image/jpeg") {
        resolve();
      } else {
        var result = EXIF.getData(file, () => {
          resolve();
        }, (err) => {
          reject(err);
        });
      }
      if (!result) {
        reject("Error in EXIF data");
      }
    });
  }

  loadImageResolutionInfo(file) {
    return new Promise((resolve, reject) => {
      if (file.type == "image/jpeg") {
        if (file.exifdata && file.exifdata.XResolution && file.exifdata.XResolution.numerator && file.exifdata.XResolution.denominator
          && file.exifdata.YResolution && file.exifdata.YResolution.numerator && file.exifdata.YResolution.denominator) {
          file.resolutionInfo = {};
          file.resolutionInfo.horizontalResolutionUnit = 'PPI';
          file.resolutionInfo.verticalResolutionUnit = 'PPI';
          file.resolutionInfo.horizontalResolution = file.exifdata.XResolution.numerator / file.exifdata.XResolution.denominator;
          file.resolutionInfo.verticalResolution = file.exifdata.YResolution.numerator / file.exifdata.YResolution.denominator;
        }
        resolve();
      }

      if (file.type == "image/png") {
        var fileReader = new FileReader();

        fileReader.onload = function (e) {
          var data = e.target.result;
          const { width, height, dpi } = parsePngFormat(data)
          if (dpi) {
            file.resolutionInfo = {};
            file.resolutionInfo.horizontalResolutionUnit = 'PPI';
            file.resolutionInfo.verticalResolutionUnit = 'PPI';
            file.resolutionInfo.horizontalResolution = dpi;
            file.resolutionInfo.verticalResolution = dpi;
          }
          resolve();
        };
        fileReader.readAsArrayBuffer(file);
      }
    });
  }

  loadImage() {
    return new Promise((resolve, reject) => {
      if (this.url) unloadImage();
      this.url = URL.createObjectURL(this.file);
      this.image = new Image();
      this.image.crossOrigin = 'anonymous';
      this.image.onload = resolve;
      this.image.onerror = reject;
      this.image.src = this.url;
    });
  }

  unloadImage() {
    if (!this.url) return;
    URL.revokeObjectURL(this.url);
    this.url = null;
    this.image = null;
  }

  getBlob() {
    return new Promise((resolve, reject) => {
      var orientation;
      if (this.file.exifdata) {
        orientation = this.file.exifdata.Orientation;
      }

      // force orientation to 1 if the exif orientation value is out of bounds or unset
      if (!orientation || orientation < 1 || orientation > 8) orientation = 1;

      var width = this.image.width;
      var height = this.image.height;
      var pixels = width * height;

      var maxPixels = 25000000;
      if (pixels > maxPixels) {
        var scale = Math.sqrt(maxPixels) / Math.sqrt(pixels);
        width = Math.round(scale * width);
        height = Math.round(scale * height);
      }

      var canvas;
      if (this.file.type == "image/jpeg" && !BrowserCompatibility.supportsNativeExif(navigator.userAgent)) {
        canvas = CanvasExifOrientation.drawImage(this.image, orientation, 0, 0, width, height);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(this.image, 0, 0, width, height);
      }
      let resolutionInfo = this.file.resolutionInfo;
      canvas.toBlob(function (blob) {
        var returnObj = { blob: blob, resolutionInfo: resolutionInfo };
        resolve(returnObj);
      }, "image/jpeg", 0.92);
    });
  }
}

/*
// monkeypatch to change "size" variable for more performance
// does this have any impact? disabled for now.
import DataWorker from 'jszip/lib/stream/DataWorker.js';
DataWorker._tick = function() {
    if(this.isPaused || this.isFinished) {
        return false;
    }
    var size = 1024 * 1024; // 16 * 1024;
    var data = null, nextIndex = Math.min(this.max, this.index + size);
    if (this.index >= this.max) {
        // EOF
        return this.end();
    } else {
        switch(this.type) {
            case "string":
                data = this.data.substring(this.index, nextIndex);
            break;
            case "uint8array":
                data = this.data.subarray(this.index, nextIndex);
            break;
            case "array":
            case "nodebuffer":
                data = this.data.slice(this.index, nextIndex);
            break;
        }
        this.index = nextIndex;
        return this.push({
            data : data,
            meta : {
                percent : this.max ? this.index / this.max * 100 : 0
            }
        });
    }
};*/

const URL = require('url');

var isiOS = false;
var isUCBrowser = false;

class ZipCanvas {
  constructor(canvas) {
    this.canvas = canvas;
  }

  export(opts = {}) {
    var mimeType = opts.mimeType ? opts.mimeType : "image/png";
    var quality = opts.quality ? opts.quality : undefined;

    return new Promise((resolve, reject) => {
      if (isiOS || isUCBrowser || !this.canvas.toBlob) {
        if (this.canvas.msToBlob) { // IE10+
          this.blob = this.canvas.msToBlob(); // is always image/png
          resolve();
        }
        else {
          this.dataUrl = this.canvas.toDataURL(mimeType, quality);
          resolve();
        }
      }
      else {
        this.canvas.toBlob((blob) => {
          this.blob = blob;
          resolve();
        }, mimeType, quality);
      }
    });
  }

  download(filename) {
    if (this.blob) {
      saveAs(this.blob, filename);
    }
    else if (this.dataUrl) {
      var link = document.createElement("a");
      link.href = this.dataUrl;
      link.target = "_blank";
      if (!isUCBrowser) {
        link.download = filename;
      }
      link.innerText = "Download";
      link.click();
    }
  }

  createURL() {
    if (this.blob) {
      return URL.createObjectURL(this.blob);
    }
    else if (this.dataUrl) {
      return this.dataUrl;
    }
  }

  revokeURL(url) {
    if (this.blob) {
      return URL.revokeObjectURL(url);
    }
  }

  static fromUrl(url, opts = {}, progress = noop) {
    return new Promise((resolve, reject) => {
      var oReq = new XMLHttpRequest();

      oReq.addEventListener("load", (e) => {
        var arraybuffer = oReq.response;
        resolve(arraybuffer);
      });
      oReq.addEventListener("error", reject);
      oReq.addEventListener("progress", (oEvent) => {
        if (oEvent.lengthComputable) {
          var percentComplete = oEvent.loaded / oEvent.total * 100;
          progress({ stage: "download", percent: Math.round(10 + percentComplete * 0.1) });
        }
      })
      oReq.open("GET", url);
      oReq.responseType = "arraybuffer";
      progress({ stage: "download", percent: 10 });
      oReq.send();
    }).then((data) => {
      return ZipCanvas.fromBinary(data, null, opts, progress);
    });
  }

  static fromBinary(data, origData, opts = {}, progress = this.noop) {
    progress({ stage: 'loadzip', percent: 20 });
    return JSZip.loadAsync(data)
      .then(zip => {
        progress({ stage: 'extractzip', percent: 30 });

        return Promise.all([
          zip.file('color.jpg').async('nodebuffer'),
          zip.file('alpha.png').async('nodebuffer')
        ]);
      })
      .then(([colorBytes, alphaBytes]) => {
        progress({ stage: 'loadimages', percent: 70 });

        var promises = [
          ZipCanvas.loadImage(colorBytes, progress),
          ZipCanvas.loadImage(alphaBytes, progress)];
        if (origData) {
          var origImgUrl = URL.createObjectURL(new Blob([origData]));
          promises.push(ZipCanvas.loadImage(origImgUrl, progress));
        }

        return Promise.all(promises).then(images => {
          return new Promise((resolve, reject) => {
            if (origData) {
              URL.revokeObjectURL(origImgUrl);
            }
            resolve(images);
          });
        });
      })
      .then(([colorImg, alphaImg, origImg]) => {
        progress({ stage: 'compositing', percent: 80 });
        return new Promise((resolve, reject) => {
          var color = ZipCanvas.getCanvas(colorImg);
          var alpha = ZipCanvas.getCanvas(alphaImg);

          var colorPx = color.ctx.getImageData(0, 0, colorImg.width, colorImg.height);
          var colorPxData = colorPx.data;
          var alphaPx = alpha.ctx.getImageData(0, 0, alphaImg.width, alphaImg.height);
          var alphaPxData = alphaPx.data;

          for (var i = 0; i < colorPxData.length; i += 4) {
            colorPxData[i + 3] = alphaPxData[i];
          }

          color.ctx.putImageData(colorPx, 0, 0);

          if (opts.usePsd) {
            var canvas_color = document.createElement('canvas');
            canvas_color.width = colorImg.width;
            canvas_color.height = colorImg.height;
            var context_color = canvas_color.getContext('2d');
            context_color.drawImage(colorImg, 0, 0);
            var canvas_alpha = document.createElement('canvas');
            canvas_alpha.width = alphaImg.width;
            canvas_alpha.height = alphaImg.height;
            var context_alpha = canvas_alpha.getContext('2d');
            context_alpha.drawImage(alphaImg, 0, 0);

            const psd = {
              width: colorImg.width,
              height: colorImg.height,
              children: [
                {
                  name: 'remove.bg',
                  canvas: canvas_color,
                  mask: {
                    canvas: canvas_alpha
                  }
                }
              ]
            };

            if (opts.bg_color) {
              var canvas_bg_color = document.createElement('canvas');
              canvas_bg_color.width = colorImg.width;
              canvas_bg_color.height = colorImg.height;

              var context_bg_color = canvas_bg_color.getContext('2d');
              context_bg_color.fillStyle = opts.bg_color;
              context_bg_color.fillRect(0, 0, colorImg.width, colorImg.height);

              psd.children.unshift({
                name: 'remove.bg - Background',
                canvas: canvas_bg_color
              });

            }

            var canvas_preview = document.createElement('canvas');
            var context_preview = canvas_preview.getContext('2d');

            canvas_preview.width = colorImg.width;
            canvas_preview.height = colorImg.height;
            if (opts.bg_color) {
              context_preview.fillStyle = opts.bg_color;
              context_preview.fillRect(0, 0, colorImg.width, colorImg.height);
            }
            context_preview.drawImage(color.canvas, 0, 0);
            psd.canvas = canvas_preview;

            if (origImg) {
              var canvas_orig = document.createElement('canvas');
              canvas_orig.width = colorImg.width;
              canvas_orig.height = colorImg.height;
              var context_orig = canvas_orig.getContext('2d');
              context_orig.drawImage(origImg, 0, 0, colorImg.width, colorImg.height);

              psd.children.unshift({
                name: 'remove.bg - Original Image',
                hidden: true,
                canvas: canvas_orig
              });
            }

            if (opts.resolutionInfo) {
              psd.imageResources = {};
              psd.imageResources.resolutionInfo = opts.resolutionInfo;
            }


            // callee is expecting a blob obj
            const blobObj = {};
            blobObj.blob = new Blob([writePsdBuffer(psd)]);

            progress({ stage: 'exporting', percent: 90 });

            resolve(blobObj);
          } else {
            progress({ stage: 'exporting', percent: 90 });

            var zipCanvas = new ZipCanvas(color.canvas);
            zipCanvas.export(opts.export).then(() => {
              resolve(zipCanvas);
            });
          }
        });
      });
  }

  static shrinkImage(image_entry, maxSize) {
    return new Promise((resolve, reject) => {
      var reader = new FileReader();
      reader.addEventListener(
        'load',
        function () {
          var image = new Image();
          image.onload = function () {
            var resized_canvas = createCanvas();
            resized_canvas.width = image.width / 2;
            resized_canvas.height = image.height / 2;

            var resized_context = resized_canvas.getContext('2d');
            resized_context.drawImage(
              image,
              0,
              0,
              resized_canvas.width,
              resized_canvas.height
            );

            image = new Image();
            image.onload = function () {
              image_entry.file = ZipCanvas.dataURLtoFile(
                image.src,
                image_entry.file.name
              );
              image_entry.width = image.width;
              image_entry.height = image.height;

              resolve(image_entry);
            };
            image.src = resized_canvas.toDataURL();
          };
          image.src = reader.result;
        },
        false
      );
      reader.readAsDataURL(image_entry.file);
    });
  }

  static dataURLtoFile(dataurl, filename) {
    var arr = dataurl.split(','),
      mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]),
      n = bstr.length,
      u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  }

  static loadImage(data, progress = noop) {
    return new Promise((resolve, reject) => {
      var image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = function () { resolve(image) };
      image.onerror = function (e) { 
        reject("Failed to load image") 
      };
      image.src = data;
    });
  }

  static getCanvas(image) {
    var canvas = createCanvas();
    var ctx = canvas.getContext("2d");

    canvas.width = image.width;
    canvas.height = image.height;

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return { canvas: canvas, ctx: ctx };
  }
}

// This class should provide different browser compatibility checks
// supportsNativeExif: Checks if browser natively respects EXIF orientation when loading an image
// For now only for Chrome 81+ supports this but other browsers will follow
// Sources: https://paul.kinlan.me/correct-image-orientation-for-images-chrome-81/
// https://www.fxsitecompat.dev/en-CA/docs/2020/jpeg-images-are-now-rotated-by-default-according-to-exif-data/
// Firefox and Safari will support in the "near future"
class BrowserCompatibility {
  static supportsNativeExif(userAgent) {
    var nVer = navigator.appVersion;
    var nAgt = navigator.userAgent;
    var browserName = navigator.appName;
    var fullVersion = '' + parseFloat(navigator.appVersion);
    var majorVersion = parseInt(navigator.appVersion, 10);
    var nameOffset, verOffset, ix;

    // In Opera, the true version is after "Opera" or after "Version"
    if ((verOffset = nAgt.indexOf("Opera")) != -1) {
      browserName = "Opera";
      fullVersion = nAgt.substring(verOffset + 6);
      if ((verOffset = nAgt.indexOf("Version")) != -1)
        fullVersion = nAgt.substring(verOffset + 8);
    }
    // In MSIE, the true version is after "MSIE" in userAgent
    else if ((verOffset = nAgt.indexOf("MSIE")) != -1) {
      browserName = "Microsoft Internet Explorer";
      fullVersion = nAgt.substring(verOffset + 5);
    }
    // In Chrome, the true version is after "Chrome"
    else if ((verOffset = nAgt.indexOf("Chrome")) != -1 || (verOffset = nAgt.indexOf("Chromium")) != -1) {
      browserName = "Chrome";
      fullVersion = nAgt.substring(verOffset + 7);
    }
    // In Safari, the true version is after "Safari" or after "Version"
    else if ((verOffset = nAgt.indexOf("Safari")) != -1) {
      browserName = "Safari";
      fullVersion = nAgt.substring(verOffset + 7);
      if ((verOffset = nAgt.indexOf("Version")) != -1)
        fullVersion = nAgt.substring(verOffset + 8);
    }
    // In Firefox, the true version is after "Firefox"
    else if ((verOffset = nAgt.indexOf("Firefox")) != -1) {
      browserName = "Firefox";
      fullVersion = nAgt.substring(verOffset + 8);
    }
    // In most other browsers, "name/version" is at the end of userAgent
    else if ((nameOffset = nAgt.lastIndexOf(' ') + 1) <
      (verOffset = nAgt.lastIndexOf('/'))) {
      browserName = nAgt.substring(nameOffset, verOffset);
      fullVersion = nAgt.substring(verOffset + 1);
      if (browserName.toLowerCase() == browserName.toUpperCase()) {
        browserName = navigator.appName;
      }
    }
    // trim the fullVersion string at semicolon/space if present
    if ((ix = fullVersion.indexOf(";")) != -1)
      fullVersion = fullVersion.substring(0, ix);
    if ((ix = fullVersion.indexOf(" ")) != -1)
      fullVersion = fullVersion.substring(0, ix);

    majorVersion = parseInt('' + fullVersion, 10);
    if (isNaN(majorVersion)) {
      fullVersion = '' + parseFloat(navigator.appVersion);
      majorVersion = parseInt(navigator.appVersion, 10);
    }

    if (browserName == "Chrome") {
      return majorVersion >= 81;
    }
    if (browserName == "Firefox") {
      return majorVersion >= 77;

    }

    return false;
  }
}

module.exports = { ImageResizer, ZipCanvas, BrowserCompatibility };
